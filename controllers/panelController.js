const { sql, getPool } = require("../db");

// ================= GET NHC MEMBERS =================
// Used for dropdown when creating panel
exports.getNhcMembers = async (req, res) => {
  try {
    const pool = await getPool();
    const nhcId = parseInt(req.params.id, 10);

    if (isNaN(nhcId)) {
      return res.status(400).json({ error: "Invalid NHC Id" });
    }

    const result = await pool
      .request()
      .input("NHC_Id", sql.Int, nhcId)
      .query(`
        SELECT 
          u.Id,
          u.FirstName,
          u.LastName,
          u.CNIC,
          u.Email,
          u.Phone,
          u.ProfileImage,
          un.NHC_Id,
          un.Role,
          un.PositionId,
          un.IsPrimary,
          un.IsActive,
          un.JoinedDate
        FROM UserNHCs un
        INNER JOIN Users u ON un.UserCNIC = u.CNIC
        WHERE un.NHC_Id = @NHC_Id
          AND un.IsActive = 1
        ORDER BY u.FirstName, u.LastName
      `);

    return res.status(200).json(result.recordset);
  } catch (err) {
    console.error("Get NHC Members Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= CREATE PANEL =================
exports.createPanel = async (req, res) => {
  let transaction;

  try {
    const pool = await getPool();

    const {
      panelName,
      presidentCnic,
      nhcId,
      treasurerCnic,
      viceCnic,
    } = req.body;

    const parsedNhcId = parseInt(nhcId, 10);

    if (
      !presidentCnic ||
      isNaN(parsedNhcId) ||
      !treasurerCnic ||
      !viceCnic
    ) {
      return res.status(400).json({
        error: "presidentCnic, nhcId, treasurerCnic and viceCnic are required",
      });
    }

    if (
      presidentCnic === treasurerCnic ||
      presidentCnic === viceCnic ||
      treasurerCnic === viceCnic
    ) {
      return res.status(400).json({
        error: "President, Treasurer and Vice President must be different users",
      });
    }

    const nhcResult = await pool
      .request()
      .input("Id", sql.Int, parsedNhcId)
      .query(`
        SELECT Id, Name
        FROM NHC_Zones
        WHERE Id = @Id
      `);

    if (nhcResult.recordset.length === 0) {
      return res.status(404).json({ error: "NHC not found" });
    }

    const nominationResult = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1
          Id,
          NHC_Id,
          NominationStartDate,
          NominationEndDate
        FROM Nominations
        WHERE NHC_Id = @NHC_Id
          AND CAST(GETDATE() AS DATE)
              BETWEEN CAST(NominationStartDate AS DATE)
              AND CAST(NominationEndDate AS DATE)
        ORDER BY Id DESC
      `);

    if (nominationResult.recordset.length === 0) {
      return res.status(400).json({
        error: "No active nomination period for this council",
      });
    }

    const nomination = nominationResult.recordset[0];
    const nominationId = nomination.Id;

    const selectedUsers = [presidentCnic, treasurerCnic, viceCnic];

    const membershipResult = await pool
      .request()
      .input("CNIC1", sql.VarChar, presidentCnic)
      .input("CNIC2", sql.VarChar, treasurerCnic)
      .input("CNIC3", sql.VarChar, viceCnic)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT 
          un.UserCNIC,
          u.FirstName,
          u.LastName
        FROM UserNHCs un
        INNER JOIN Users u ON un.UserCNIC = u.CNIC
        WHERE un.UserCNIC IN (@CNIC1, @CNIC2, @CNIC3)
          AND un.NHC_Id = @NHC_Id
          AND un.IsActive = 1
      `);

    if (membershipResult.recordset.length !== 3) {
      return res.status(400).json({
        error: "All selected panel members must belong to this council",
      });
    }

    for (const cnic of selectedUsers) {
      const duplicateCheck = await pool
        .request()
        .input("CNIC", sql.VarChar, cnic)
        .input("NominationId", sql.Int, nominationId)
        .input("NHC_Id", sql.Int, parsedNhcId)
        .query(`
          SELECT TOP 1 pm.Id
          FROM PanelMembers pm
          INNER JOIN Panels p ON pm.PanelId = p.Id
          WHERE pm.CNIC = @CNIC
            AND p.NominationId = @NominationId
            AND p.NHC_Id = @NHC_Id
            AND LOWER(pm.InviteStatus) IN ('pending', 'accepted')
            AND LOWER(ISNULL(pm.MemberStatus, 'pending')) IN ('pending', 'active')
            AND LOWER(p.Status) IN ('pending', 'approved')
        `);

      if (duplicateCheck.recordset.length > 0) {
        return res.status(400).json({
          error: `User ${cnic} is already part of another panel in this nomination`,
        });
      }
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const cleanPanelName =
      panelName && panelName.trim() !== "" ? panelName.trim() : "Unnamed Panel";

    const panelInsert = await new sql.Request(transaction)
      .input("PanelName", sql.NVarChar, cleanPanelName)
      .input("PresidentCNIC", sql.VarChar, presidentCnic)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .input("NominationId", sql.Int, nominationId)
      .query(`
        INSERT INTO Panels
        (
          PanelName,
          PresidentCNIC,
          NHC_Id,
          Status,
          NominationId,
          CreatedDate
        )
        OUTPUT INSERTED.Id
        VALUES
        (
          @PanelName,
          @PresidentCNIC,
          @NHC_Id,
          'pending',
          @NominationId,
          GETDATE()
        )
      `);

    const panelId = panelInsert.recordset[0].Id;

    const panelMembers = [
      {
        cnic: presidentCnic,
        role: "President",
        inviteStatus: "accepted",
        memberStatus: "Active",
      },
      {
        cnic: treasurerCnic,
        role: "Treasurer",
        inviteStatus: "pending",
        memberStatus: "Pending",
      },
      {
        cnic: viceCnic,
        role: "Vice President",
        inviteStatus: "pending",
        memberStatus: "Pending",
      },
    ];

    for (const member of panelMembers) {
      await new sql.Request(transaction)
        .input("PanelId", sql.Int, panelId)
        .input("CNIC", sql.VarChar, member.cnic)
        .input("Role", sql.NVarChar, member.role)
        .input("InviteStatus", sql.NVarChar, member.inviteStatus)
        .input("MemberStatus", sql.NVarChar, member.memberStatus)
        .query(`
          INSERT INTO PanelMembers
          (
            PanelId,
            CNIC,
            Role,
            InviteStatus,
            MemberStatus,
            CreatedDate
          )
          VALUES
          (
            @PanelId,
            @CNIC,
            @Role,
            @InviteStatus,
            @MemberStatus,
            GETDATE()
          )
        `);
    }

    const invites = [
      {
        cnic: treasurerCnic,
        role: "Treasurer",
        message: `You have been invited to join panel "${cleanPanelName}" as Treasurer.`,
      },
      {
        cnic: viceCnic,
        role: "Vice President",
        message: `You have been invited to join panel "${cleanPanelName}" as Vice President.`,
      },
    ];

    for (const invite of invites) {
      await new sql.Request(transaction)
        .input("RecipientCNIC", sql.VarChar, invite.cnic)
        .input("Message", sql.NVarChar(sql.MAX), invite.message)
        .input("PanelId", sql.Int, panelId)
        .input("Role", sql.NVarChar, invite.role)
        .input("IsRead", sql.Bit, 0)
        .query(`
          INSERT INTO Notifications
          (
            RecipientCNIC,
            Message,
            CreatedDate,
            PanelId,
            Role,
            ComplaintId,
            IsRead
          )
          VALUES
          (
            @RecipientCNIC,
            @Message,
            GETDATE(),
            @PanelId,
            @Role,
            NULL,
            @IsRead
          )
        `);
    }

    await transaction.commit();

    return res.status(201).json({
      message: "Panel created successfully. Invitations sent.",
      panelId,
      nominationId,
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("Create Panel Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= GET PANELS =================
exports.getPanels = async (req, res) => {
  try {
    const pool = await getPool();

    const cnic = req.query.cnic || null;
    const nhcId = req.query.nhcId ? parseInt(req.query.nhcId, 10) : null;
    const nominationId = req.query.nominationId
      ? parseInt(req.query.nominationId, 10)
      : null;

    let query = `
      SELECT
        p.Id,
        p.PanelName,
        p.PresidentCNIC,
        p.NHC_Id,
        p.NominationId,
        p.Status,
        p.CreatedDate
      FROM Panels p
    `;

    const conditions = [];
    const request = pool.request();

    if (cnic) {
      conditions.push(`
        EXISTS (
          SELECT 1
          FROM PanelMembers pm
          WHERE pm.PanelId = p.Id
            AND pm.CNIC = @CNIC
        )
      `);
      request.input("CNIC", sql.VarChar, cnic);
    }

    if (nhcId && !isNaN(nhcId)) {
      conditions.push("p.NHC_Id = @NHC_Id");
      request.input("NHC_Id", sql.Int, nhcId);
    }

    if (nominationId && !isNaN(nominationId)) {
      conditions.push("p.NominationId = @NominationId");
      request.input("NominationId", sql.Int, nominationId);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY p.Id DESC`;

    const result = await request.query(query);

    return res.status(200).json(result.recordset);
  } catch (err) {
    console.error("Get Panels Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= GET PANEL MEMBERS =================
exports.getPanelMembers = async (req, res) => {
  try {
    const pool = await getPool();
    const panelId = parseInt(req.params.id, 10);

    if (isNaN(panelId)) {
      return res.status(400).json({
        error: "Invalid panel id",
      });
    }

    const result = await pool
      .request()
      .input("PanelId", sql.Int, panelId)
      .query(`
        SELECT
          pm.Id AS id,
          pm.PanelId AS panelId,
          pm.CNIC AS cnic,
          pm.Role AS role,
          pm.InviteStatus AS inviteStatus,
          pm.MemberStatus AS memberStatus,
          pm.CreatedDate AS createdDate,

          u.FirstName AS firstName,
          u.LastName AS lastName,
          u.Email AS email,
          u.Phone AS phone,
          u.ProfileImage AS profileImage
        FROM PanelMembers pm
        LEFT JOIN Users u ON pm.CNIC = u.CNIC
        WHERE pm.PanelId = @PanelId
        ORDER BY
          CASE
            WHEN pm.Role = 'President' THEN 1
            WHEN pm.Role = 'Treasurer' THEN 2
            WHEN pm.Role = 'Vice President' THEN 3
            ELSE 4
          END
      `);

    return res.status(200).json(result.recordset);
  } catch (err) {
    console.error("getPanelMembers Error:", err);

    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};

// ================= ACCEPT PANEL INVITATION =================
exports.acceptInvitation = async (req, res) => {
  let transaction;

  try {
    const pool = await getPool();

    const panelId = parseInt(req.params.id, 10);
    const { cnic } = req.body;

    if (isNaN(panelId) || !cnic) {
      return res.status(400).json({
        error: "panel id and cnic are required",
      });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const panelInfo = await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .query(`
        SELECT
          Id,
          PanelName,
          PresidentCNIC,
          NHC_Id,
          Status,
          NominationId
        FROM Panels
        WHERE Id = @PanelId
      `);

    if (panelInfo.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "Panel not found" });
    }

    const panel = panelInfo.recordset[0];

    if (String(panel.Status).toLowerCase() === "rejected") {
      await transaction.rollback();
      return res.status(400).json({
        error: "This panel is already rejected",
      });
    }

    if (String(panel.Status).toLowerCase() === "incomplete") {
      await transaction.rollback();
      return res.status(400).json({
        error: "This panel is incomplete",
      });
    }

    if (!panel.NominationId) {
      await transaction.rollback();
      return res.status(400).json({
        error: "Panel is not linked to a nomination",
      });
    }

    const memberInfo = await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .input("CNIC", sql.VarChar, cnic)
      .query(`
        SELECT Id, Role, InviteStatus, MemberStatus
        FROM PanelMembers
        WHERE PanelId = @PanelId
          AND CNIC = @CNIC
      `);

    if (memberInfo.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "Invitation not found" });
    }

    const member = memberInfo.recordset[0];

    if (member.Role === "President") {
      await transaction.rollback();
      return res.status(400).json({
        error: "President does not need to accept invitation",
      });
    }

    if (String(member.InviteStatus).toLowerCase() === "accepted") {
      await transaction.rollback();
      return res.status(400).json({
        error: "Invitation already accepted",
      });
    }

    if (
      String(member.InviteStatus).toLowerCase() === "declined" ||
      String(member.InviteStatus).toLowerCase() === "rejected" ||
      String(member.MemberStatus).toLowerCase() === "declined"
    ) {
      await transaction.rollback();
      return res.status(400).json({
        error: "Invitation already declined",
      });
    }

    if (String(member.MemberStatus).toLowerCase() === "left") {
      await transaction.rollback();
      return res.status(400).json({
        error: "You already left this panel",
      });
    }

    const membershipCheck = await new sql.Request(transaction)
      .input("UserCNIC", sql.VarChar, cnic)
      .input("NHC_Id", sql.Int, panel.NHC_Id)
      .query(`
        SELECT TOP 1 Id
        FROM UserNHCs
        WHERE UserCNIC = @UserCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    if (membershipCheck.recordset.length === 0) {
      await transaction.rollback();
      return res.status(403).json({
        error: "You are not a member of this council",
      });
    }

    const duplicateCheck = await new sql.Request(transaction)
      .input("CNIC", sql.VarChar, cnic)
      .input("NominationId", sql.Int, panel.NominationId)
      .input("NHC_Id", sql.Int, panel.NHC_Id)
      .input("CurrentPanelId", sql.Int, panelId)
      .query(`
        SELECT TOP 1 pm.Id
        FROM PanelMembers pm
        INNER JOIN Panels p ON pm.PanelId = p.Id
        WHERE pm.CNIC = @CNIC
          AND p.NominationId = @NominationId
          AND p.NHC_Id = @NHC_Id
          AND p.Id <> @CurrentPanelId
          AND LOWER(pm.InviteStatus) IN ('pending', 'accepted')
          AND LOWER(ISNULL(pm.MemberStatus, 'pending')) IN ('pending', 'active')
          AND LOWER(p.Status) IN ('pending', 'approved')
      `);

    if (duplicateCheck.recordset.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: "You are already in another panel for this nomination",
      });
    }

    await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .input("CNIC", sql.VarChar, cnic)
      .query(`
        UPDATE PanelMembers
        SET InviteStatus = 'accepted',
            MemberStatus = 'Active'
        WHERE PanelId = @PanelId
          AND CNIC = @CNIC
      `);

    const membersResult = await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .query(`
        SELECT CNIC, Role, InviteStatus, MemberStatus
        FROM PanelMembers
        WHERE PanelId = @PanelId
          AND Role IN ('President', 'Treasurer', 'Vice President')
      `);

    const totalMembers = membersResult.recordset.length;

    const activeMembers = membersResult.recordset.filter((m) => {
      return (
        String(m.InviteStatus).toLowerCase() === "accepted" &&
        String(m.MemberStatus).toLowerCase() === "active"
      );
    }).length;

    const allAccepted = totalMembers === 3 && activeMembers === 3;

    if (allAccepted) {
      await new sql.Request(transaction)
        .input("PanelId", sql.Int, panelId)
        .query(`
          UPDATE Panels
          SET Status = 'approved'
          WHERE Id = @PanelId
        `);

      const nominationResult = await new sql.Request(transaction)
        .input("NominationId", sql.Int, panel.NominationId)
        .query(`
          SELECT TOP 1 Id, NominationEndDate
          FROM Nominations
          WHERE Id = @NominationId
        `);

      if (nominationResult.recordset.length === 0) {
        await transaction.rollback();
        return res.status(400).json({
          error: "Related nomination not found",
        });
      }

      const nominationEndDate = nominationResult.recordset[0].NominationEndDate;

      const candidateExists = await new sql.Request(transaction)
        .input("PanelId", sql.Int, panelId)
        .input("NominationId", sql.Int, panel.NominationId)
        .query(`
          SELECT TOP 1 Id
          FROM Candidates
          WHERE PanelId = @PanelId
            AND NominationId = @NominationId
        `);

      if (candidateExists.recordset.length === 0) {
        await new sql.Request(transaction)
          .input("CNIC", sql.VarChar, panel.PresidentCNIC)
          .input("NHC_Id", sql.Int, panel.NHC_Id)
          .input("Category", sql.NVarChar, "President")
          .input("Status", sql.NVarChar, "Pending")
          .input("NominationEndDate", sql.Date, nominationEndDate)
          .input("TotalVotes", sql.Int, 0)
          .input("IsEligible", sql.Bit, 0)
          .input("PanelId", sql.Int, panelId)
          .input("NominationId", sql.Int, panel.NominationId)
          .query(`
            INSERT INTO Candidates
            (
              CNIC,
              NHC_Id,
              Category,
              Status,
              NominationEndDate,
              TotalVotes,
              IsEligible,
              PanelId,
              NominationId
            )
            VALUES
            (
              @CNIC,
              @NHC_Id,
              @Category,
              @Status,
              @NominationEndDate,
              @TotalVotes,
              @IsEligible,
              @PanelId,
              @NominationId
            )
          `);
      }

      await new sql.Request(transaction)
        .input("RecipientCNIC", sql.VarChar, panel.PresidentCNIC)
        .input(
          "Message",
          sql.NVarChar(sql.MAX),
          `Your panel "${panel.PanelName || "Unnamed Panel"}" has been approved.`
        )
        .input("PanelId", sql.Int, panelId)
        .input("IsRead", sql.Bit, 0)
        .query(`
          INSERT INTO Notifications
          (
            RecipientCNIC,
            Message,
            CreatedDate,
            PanelId,
            IsRead
          )
          VALUES
          (
            @RecipientCNIC,
            @Message,
            GETDATE(),
            @PanelId,
            @IsRead
          )
        `);
    }

    await transaction.commit();

    return res.status(200).json({
      message: allAccepted
        ? "Invitation accepted and panel approved"
        : "Invitation accepted",
      panelStatus: allAccepted ? "approved" : "pending",
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("Accept Invitation Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= DECLINE PANEL INVITATION =================
exports.declineInvitation = async (req, res) => {
  let transaction;

  try {
    const pool = await getPool();

    const panelId = parseInt(req.params.id, 10);
    const { cnic } = req.body;

    if (isNaN(panelId) || !cnic) {
      return res.status(400).json({
        error: "panel id and cnic are required",
      });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const panelInfo = await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .query(`
        SELECT Id, PanelName, PresidentCNIC, Status
        FROM Panels
        WHERE Id = @PanelId
      `);

    if (panelInfo.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "Panel not found" });
    }

    const panel = panelInfo.recordset[0];

    if (String(panel.Status).toLowerCase() === "approved") {
      await transaction.rollback();
      return res.status(400).json({
        error: "This panel is already approved",
      });
    }

    if (String(panel.Status).toLowerCase() === "incomplete") {
      await transaction.rollback();
      return res.status(400).json({
        error: "This panel is already incomplete",
      });
    }

    const memberInfo = await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .input("CNIC", sql.VarChar, cnic)
      .query(`
        SELECT Id, Role, InviteStatus, MemberStatus
        FROM PanelMembers
        WHERE PanelId = @PanelId
          AND CNIC = @CNIC
      `);

    if (memberInfo.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        error: "Invitation not found",
      });
    }

    const member = memberInfo.recordset[0];

    if (member.Role === "President") {
      await transaction.rollback();
      return res.status(400).json({
        error: "President cannot decline own panel",
      });
    }

    if (
      String(member.InviteStatus).toLowerCase() === "declined" ||
      String(member.InviteStatus).toLowerCase() === "rejected" ||
      String(member.MemberStatus).toLowerCase() === "declined"
    ) {
      await transaction.rollback();
      return res.status(400).json({
        error: "Invitation already declined",
      });
    }

    await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .input("CNIC", sql.VarChar, cnic)
      .query(`
        UPDATE PanelMembers
        SET InviteStatus = 'declined',
            MemberStatus = 'Declined'
        WHERE PanelId = @PanelId
          AND CNIC = @CNIC
      `);

    await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .query(`
        UPDATE Panels
        SET Status = 'rejected'
        WHERE Id = @PanelId
      `);

    await new sql.Request(transaction)
      .input("RecipientCNIC", sql.VarChar, panel.PresidentCNIC)
      .input(
        "Message",
        sql.NVarChar(sql.MAX),
        `Your panel "${panel.PanelName || "Unnamed Panel"}" has been rejected because one member declined the invitation.`
      )
      .input("PanelId", sql.Int, panelId)
      .input("IsRead", sql.Bit, 0)
      .query(`
        INSERT INTO Notifications
        (
          RecipientCNIC,
          Message,
          CreatedDate,
          PanelId,
          IsRead
        )
        VALUES
        (
          @RecipientCNIC,
          @Message,
          GETDATE(),
          @PanelId,
          @IsRead
        )
      `);

    await transaction.commit();

    return res.status(200).json({
      message: "Invitation declined and panel rejected",
      panelStatus: "rejected",
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("Decline Invitation Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= GET MY NOMINATION RESULT =================
// Shows result only after nomination is ended
// Panel members can see whether their panel was nominated and who supported it
exports.getMyNominationResult = async (req, res) => {
  try {
    const pool = await getPool();

    const { cnic, nhcId } = req.query;
    const parsedNhcId = parseInt(nhcId, 10);

    if (!cnic || isNaN(parsedNhcId)) {
      return res.status(400).json({
        error: "cnic and nhcId are required",
      });
    }

    const membershipCheck = await pool
      .request()
      .input("UserCNIC", sql.VarChar, cnic)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1 Id
        FROM UserNHCs
        WHERE UserCNIC = @UserCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    if (membershipCheck.recordset.length === 0) {
      return res.status(403).json({
        error: "You are not a member of this council",
      });
    }

    const nominationResult = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1
          Id,
          NHC_Id,
          NominationStartDate,
          NominationEndDate,
          ISNULL(IsEnded, 0) AS IsEnded
        FROM Nominations
        WHERE NHC_Id = @NHC_Id
          AND ISNULL(IsEnded, 0) = 1
        ORDER BY Id DESC
      `);

    if (nominationResult.recordset.length === 0) {
      return res.status(200).json({
        resultAvailable: false,
        hasPanel: false,
        message: "Nomination result is not available yet",
        supporters: [],
      });
    }

    const nomination = nominationResult.recordset[0];

    const panelResult = await pool
      .request()
      .input("CNIC", sql.VarChar, cnic)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .input("NominationId", sql.Int, nomination.Id)
      .query(`
        SELECT TOP 1
          p.Id AS panelId,
          p.PanelName AS panelName,
          p.Status AS panelStatus,
          p.PresidentCNIC AS presidentCnic,
          p.NHC_Id AS nhcId,
          p.NominationId AS nominationId,
          p.CreatedDate AS createdDate,

          presidentUser.FirstName + ' ' + presidentUser.LastName AS presidentName,

          treasurerPm.CNIC AS treasurerCnic,
          treasurerUser.FirstName + ' ' + treasurerUser.LastName AS treasurerName,
          treasurerPm.InviteStatus AS treasurerInviteStatus,
          treasurerPm.MemberStatus AS treasurerMemberStatus,

          vicePm.CNIC AS vicePresidentCnic,
          viceUser.FirstName + ' ' + viceUser.LastName AS vicePresidentName,
          vicePm.InviteStatus AS vicePresidentInviteStatus,
          vicePm.MemberStatus AS vicePresidentMemberStatus

        FROM Panels p

        INNER JOIN PanelMembers myPm
          ON p.Id = myPm.PanelId
         AND myPm.CNIC = @CNIC

        LEFT JOIN Users presidentUser
          ON p.PresidentCNIC = presidentUser.CNIC

        LEFT JOIN PanelMembers treasurerPm
          ON p.Id = treasurerPm.PanelId
         AND treasurerPm.Role = 'Treasurer'

        LEFT JOIN Users treasurerUser
          ON treasurerPm.CNIC = treasurerUser.CNIC

        LEFT JOIN PanelMembers vicePm
          ON p.Id = vicePm.PanelId
         AND vicePm.Role = 'Vice President'

        LEFT JOIN Users viceUser
          ON vicePm.CNIC = viceUser.CNIC

        WHERE p.NHC_Id = @NHC_Id
          AND p.NominationId = @NominationId
        ORDER BY p.Id DESC
      `);

    if (panelResult.recordset.length === 0) {
      return res.status(200).json({
        resultAvailable: true,
        hasPanel: false,
        nominationId: nomination.Id,
        nominationStartDate: nomination.NominationStartDate,
        nominationEndDate: nomination.NominationEndDate,
        message: "You were not part of any panel in this nomination",
        supporters: [],
      });
    }

    const panel = panelResult.recordset[0];

    const candidateResult = await pool
      .request()
      .input("PanelId", sql.Int, panel.panelId)
      .input("NominationId", sql.Int, nomination.Id)
      .query(`
        SELECT TOP 1
          Id AS candidateId,
          Status AS candidateStatus,
          TotalVotes AS totalSupports,
          IsEligible AS isEligible
        FROM Candidates
        WHERE PanelId = @PanelId
          AND NominationId = @NominationId
        ORDER BY Id DESC
      `);

    const candidate =
      candidateResult.recordset.length > 0
        ? candidateResult.recordset[0]
        : null;

    let supporters = [];

    if (candidate) {
      const supportersResult = await pool
        .request()
        .input("CandidateId", sql.Int, candidate.candidateId)
        .input("NominationId", sql.Int, nomination.Id)
        .query(`
          SELECT
            cs.Id AS supportId,
            cs.CandidateId AS candidateId,
            cs.NominationId AS nominationId,
            cs.SupporterCNIC AS supporterCnic,
            cs.NHC_Id AS nhcId,
            cs.CreatedDate AS supportedDate,

            u.FirstName AS firstName,
            u.LastName AS lastName,
            u.Phone AS phone,
            u.Email AS email,
            u.ProfileImage AS profileImage
          FROM CandidateSupports cs
          INNER JOIN Users u
            ON cs.SupporterCNIC = u.CNIC
          WHERE cs.CandidateId = @CandidateId
            AND cs.NominationId = @NominationId
          ORDER BY cs.CreatedDate DESC
        `);

      supporters = supportersResult.recordset;
    }

    const totalSupports = candidate ? candidate.totalSupports || 0 : 0;

    const isNominated =
      candidate &&
      Number(candidate.isEligible) === 1 &&
      String(candidate.candidateStatus).toLowerCase() === "approved";

    return res.status(200).json({
      resultAvailable: true,
      hasPanel: true,

      nominationId: nomination.Id,
      nominationStartDate: nomination.NominationStartDate,
      nominationEndDate: nomination.NominationEndDate,

      panel,

      candidateCreated: !!candidate,
      candidate,
      totalSupports,
      requiredSupports: 10,
      isNominated,

      supporters,
    });
  } catch (error) {
    console.error("getMyNominationResult error:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch nomination result",
    });
  }
};

// ================= RESIGN / LEAVE FROM PANEL =================
exports.resignFromPanel = async (req, res) => {
  let transaction;

  try {
    const pool = await getPool();

    const panelId = parseInt(req.params.panelId, 10);
    const { cnic } = req.body;

    if (isNaN(panelId)) {
      return res.status(400).json({
        error: "Invalid panel id",
      });
    }

    if (!cnic || cnic.toString().trim() === "") {
      return res.status(400).json({
        error: "CNIC is required",
      });
    }

    const cleanCnic = cnic.toString().trim();

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const panelCheck = await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .query(`
        SELECT TOP 1
          Id,
          PanelName,
          PresidentCNIC,
          Status,
          NominationId
        FROM Panels
        WHERE Id = @PanelId
      `);

    if (panelCheck.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        error: "Panel not found",
      });
    }

    const panel = panelCheck.recordset[0];
    const panelStatus = (panel.Status || "").toString().toLowerCase();

    if (panelStatus !== "approved") {
      await transaction.rollback();
      return res.status(400).json({
        error: "You can leave only after panel is approved",
      });
    }

    const memberCheck = await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .input("CNIC", sql.VarChar, cleanCnic)
      .query(`
        SELECT TOP 1
          Id,
          PanelId,
          CNIC,
          Role,
          InviteStatus,
          MemberStatus
        FROM PanelMembers
        WHERE PanelId = @PanelId
          AND CNIC = @CNIC
      `);

    if (memberCheck.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        error: "You are not part of this panel",
      });
    }

    const member = memberCheck.recordset[0];

    const inviteStatus = (member.InviteStatus || "").toString().toLowerCase();
    const memberStatus = (member.MemberStatus || "").toString().toLowerCase();

    if (inviteStatus !== "accepted" || memberStatus !== "active") {
      await transaction.rollback();
      return res.status(400).json({
        error: "Only accepted active panel members can leave the panel",
      });
    }

    await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .input("CNIC", sql.VarChar, cleanCnic)
      .query(`
        UPDATE PanelMembers
        SET MemberStatus = 'Left'
        WHERE PanelId = @PanelId
          AND CNIC = @CNIC
      `);

    await new sql.Request(transaction)
      .input("PanelId", sql.Int, panelId)
      .query(`
        UPDATE Panels
        SET Status = 'incomplete'
        WHERE Id = @PanelId
      `);

    await new sql.Request(transaction)
      .input("RecipientCNIC", sql.VarChar, panel.PresidentCNIC)
      .input(
        "Message",
        sql.NVarChar(sql.MAX),
        `A member has left your panel "${panel.PanelName || "Unnamed Panel"}". The panel is now incomplete.`
      )
      .input("PanelId", sql.Int, panelId)
      .input("IsRead", sql.Bit, 0)
      .query(`
        INSERT INTO Notifications
        (
          RecipientCNIC,
          Message,
          CreatedDate,
          PanelId,
          IsRead
        )
        VALUES
        (
          @RecipientCNIC,
          @Message,
          GETDATE(),
          @PanelId,
          @IsRead
        )
      `);

    await transaction.commit();

    return res.status(200).json({
      message: "You left the panel successfully",
      panelStatus: "incomplete",
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("resignFromPanel Error:", err);

    return res.status(500).json({
      error: err.message || "Server Error",
    });
  }
};