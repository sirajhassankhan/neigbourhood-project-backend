const { sql, getPool } = require("../db");

// ================= GET ALL NOMINATIONS =================
exports.getNominations = async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT 
        N.Id,
        N.NHC_Id,
        Z.Name,
        N.NominationStartDate,
        N.NominationEndDate,
        ISNULL(N.IsEnded, 0) AS IsEnded,
        N.CreatedDate
      FROM Nominations N
      JOIN NHC_Zones Z ON N.NHC_Id = Z.Id
      ORDER BY N.Id DESC
    `);

    return res.status(200).json(result.recordset);
  } catch (err) {
    console.error("Get Nominations Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= CREATE NOMINATION PERIOD =================
exports.createNomination = async (req, res) => {
  try {
    const pool = await getPool();
    const { nhcId, startDate, endDate } = req.body;

    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId) || !startDate || !endDate) {
      return res.status(400).json({ error: "Missing Fields" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    // Same date is allowed
    if (start > end) {
      return res.status(400).json({
        error: "Start date cannot be after end date",
      });
    }

    const nhcCheck = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1 Id
        FROM NHC_Zones
        WHERE Id = @NHC_Id
      `);

    if (nhcCheck.recordset.length === 0) {
      return res.status(404).json({
        error: "NHC not found",
      });
    }

    // Only block overlapping active/not-ended nomination.
    // Ended nomination should not block testing.
    const overlap = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .input("StartDate", sql.Date, startDate)
      .input("EndDate", sql.Date, endDate)
      .query(`
        SELECT TOP 1 Id
        FROM Nominations
        WHERE NHC_Id = @NHC_Id
          AND ISNULL(IsEnded, 0) = 0
          AND (
            (@StartDate BETWEEN NominationStartDate AND NominationEndDate)
            OR
            (@EndDate BETWEEN NominationStartDate AND NominationEndDate)
            OR
            (NominationStartDate BETWEEN @StartDate AND @EndDate)
          )
      `);

    if (overlap.recordset.length > 0) {
      return res.status(400).json({
        error: "Nomination period overlaps existing active schedule",
      });
    }

    await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .input("NominationStartDate", sql.Date, startDate)
      .input("NominationEndDate", sql.Date, endDate)
      .query(`
        INSERT INTO Nominations
        (
          NHC_Id,
          NominationStartDate,
          NominationEndDate,
          IsEnded,
          CreatedDate
        )
        VALUES
        (
          @NHC_Id,
          @NominationStartDate,
          @NominationEndDate,
          0,
          GETDATE()
        )
      `);

    return res.status(201).json({
      message: "Nomination Period Created Successfully",
    });
  } catch (err) {
    console.error("Create Nomination Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= DELETE NOMINATION =================
exports.deleteNomination = async (req, res) => {
  try {
    const pool = await getPool();
    const { id } = req.params;
    const nominationId = parseInt(id, 10);

    if (isNaN(nominationId)) {
      return res.status(400).json({ error: "Invalid nomination id" });
    }

    await pool
      .request()
      .input("Id", sql.Int, nominationId)
      .query(`
        DELETE FROM Nominations
        WHERE Id = @Id
      `);

    return res.status(200).json({ message: "Nomination Deleted" });
  } catch (err) {
    console.error("Delete Nomination Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= END NOMINATION =================
exports.endNomination = async (req, res) => {
  try {
    const pool = await getPool();
    const { id } = req.params;
    const nominationId = parseInt(id, 10);

    if (isNaN(nominationId)) {
      return res.status(400).json({ error: "Invalid nomination id" });
    }

    const existing = await pool
      .request()
      .input("Id", sql.Int, nominationId)
      .query(`
        SELECT TOP 1
          Id,
          NHC_Id,
          NominationStartDate,
          NominationEndDate,
          ISNULL(IsEnded, 0) AS IsEnded
        FROM Nominations
        WHERE Id = @Id
      `);

    if (existing.recordset.length === 0) {
      return res.status(404).json({ error: "Nomination not found" });
    }

    if (existing.recordset[0].IsEnded === true || existing.recordset[0].IsEnded === 1) {
      return res.status(400).json({
        error: "Nomination already ended",
      });
    }

    await pool
      .request()
      .input("Id", sql.Int, nominationId)
      .query(`
        UPDATE Nominations
        SET IsEnded = 1,
            NominationEndDate = CAST(GETDATE() AS DATE)
        WHERE Id = @Id
      `);

    return res.status(200).json({
      message: "Nomination Ended Successfully",
    });
  } catch (err) {
    console.error("End Nomination Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= GET ACTIVE NOMINATION =================
exports.getActiveNomination = async (req, res) => {
  try {
    const { nhcId } = req.params;
    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({ message: "Invalid NHC id" });
    }

    const pool = await getPool();

    const result = await pool
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
          AND ISNULL(IsEnded, 0) = 0
          AND CAST(GETDATE() AS DATE)
              BETWEEN CAST(NominationStartDate AS DATE)
              AND CAST(NominationEndDate AS DATE)
        ORDER BY Id DESC
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: "No active nomination found",
      });
    }

    return res.status(200).json({
      nominationId: result.recordset[0].Id,
      nhcId: result.recordset[0].NHC_Id,
      nominationStartDate: result.recordset[0].NominationStartDate,
      nominationEndDate: result.recordset[0].NominationEndDate,
      isEnded: result.recordset[0].IsEnded,
    });
  } catch (error) {
    console.error("getActiveNomination error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// ================= GET ENDED NOMINATION BY NHC =================
// Useful for nomination result screen
exports.getLatestEndedNominationByNhc = async (req, res) => {
  try {
    const { nhcId } = req.params;
    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({ message: "Invalid NHC id" });
    }

    const pool = await getPool();

    const result = await pool
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

    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: "No ended nomination found",
      });
    }

    return res.status(200).json({
      nominationId: result.recordset[0].Id,
      nhcId: result.recordset[0].NHC_Id,
      nominationStartDate: result.recordset[0].NominationStartDate,
      nominationEndDate: result.recordset[0].NominationEndDate,
      isEnded: result.recordset[0].IsEnded,
    });
  } catch (error) {
    console.error("getLatestEndedNominationByNhc error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// ================= GET NOMINATION CANDIDATES =================
exports.getNominationCandidates = async (req, res) => {
  try {
    const pool = await getPool();

    const nominationId = parseInt(req.params.nominationId, 10);
    const currentUserCnic = req.query.cnic;

    if (isNaN(nominationId)) {
      return res.status(400).json({
        error: "Invalid nomination id",
      });
    }

    if (!currentUserCnic || currentUserCnic.toString().trim() === "") {
      return res.status(400).json({
        error: "cnic is required",
      });
    }

    const nominationResult = await pool
      .request()
      .input("NominationId", sql.Int, nominationId)
      .query(`
        SELECT TOP 1
          Id,
          NHC_Id,
          NominationStartDate,
          NominationEndDate
        FROM Nominations
        WHERE Id = @NominationId
      `);

    if (nominationResult.recordset.length === 0) {
      return res.status(404).json({
        error: "Nomination not found",
      });
    }

    const nomination = nominationResult.recordset[0];

    const candidatesResult = await pool
      .request()
      .input("NominationId", sql.Int, nominationId)
      .query(`
        SELECT
          c.Id AS candidateId,
          c.Id AS id,
          c.CNIC AS cnic,
          c.NHC_Id AS nhcId,
          c.Category AS category,
          c.Status AS status,
          c.NominationEndDate AS nominationEndDate,
          c.TotalVotes AS totalVotes,
          c.IsEligible AS isEligible,
          c.PanelId AS panelId,
          c.NominationId AS nominationId,

          p.PanelName AS panelName,
          p.Status AS panelStatus,
          p.PresidentCNIC AS presidentCnic,

          presidentUser.FirstName + ' ' + presidentUser.LastName AS presidentName,
          presidentUser.ProfileImage AS presidentImage,

          treasurerPm.CNIC AS treasurerCnic,
          treasurerUser.FirstName + ' ' + treasurerUser.LastName AS treasurerName,
          treasurerUser.ProfileImage AS treasurerImage,

          vicePm.CNIC AS vicePresidentCnic,
          viceUser.FirstName + ' ' + viceUser.LastName AS vicePresidentName,
          viceUser.ProfileImage AS vicePresidentImage

        FROM Candidates c

        INNER JOIN Panels p
          ON c.PanelId = p.Id

        LEFT JOIN Users presidentUser
          ON p.PresidentCNIC = presidentUser.CNIC

        LEFT JOIN PanelMembers treasurerPm
          ON p.Id = treasurerPm.PanelId
         AND treasurerPm.Role = 'Treasurer'
         AND treasurerPm.InviteStatus = 'accepted'
         AND treasurerPm.MemberStatus = 'Active'

        LEFT JOIN Users treasurerUser
          ON treasurerPm.CNIC = treasurerUser.CNIC

        LEFT JOIN PanelMembers vicePm
          ON p.Id = vicePm.PanelId
         AND vicePm.Role = 'Vice President'
         AND vicePm.InviteStatus = 'accepted'
         AND vicePm.MemberStatus = 'Active'

        LEFT JOIN Users viceUser
          ON vicePm.CNIC = viceUser.CNIC

        WHERE c.NominationId = @NominationId
          AND p.NominationId = @NominationId
          AND LOWER(p.Status) = 'approved'

        ORDER BY c.Id DESC
      `);

    const supportCheck = await pool
      .request()
      .input("NominationId", sql.Int, nominationId)
      .input("SupporterCNIC", sql.VarChar, currentUserCnic)
      .query(`
        SELECT TOP 1
          CandidateId
        FROM CandidateSupports
        WHERE NominationId = @NominationId
          AND SupporterCNIC = @SupporterCNIC
        ORDER BY Id DESC
      `);

    const alreadySupported = supportCheck.recordset.length > 0;
    const supportedCandidateId = alreadySupported
      ? supportCheck.recordset[0].CandidateId
      : null;

    return res.status(200).json({
      nominationId: nomination.Id,
      nhcId: nomination.NHC_Id,
      nominationStartDate: nomination.NominationStartDate,
      nominationEndDate: nomination.NominationEndDate,

      alreadySupported,
      supportedCandidateId,

      candidates: candidatesResult.recordset,
    });
  } catch (error) {
    console.error("getNominationCandidates error:", error);

    return res.status(500).json({
      error: error.message || "Failed to fetch nomination candidates",
    });
  }
};

// ================= SUPPORT CANDIDATE =================
exports.supportCandidate = async (req, res) => {
  let transaction;

  try {
    const { nominationId } = req.params;
    const { candidateId, supporterCNIC, nhcId } = req.body;

    const parsedNominationId = parseInt(nominationId, 10);
    const parsedCandidateId = parseInt(candidateId, 10);
    const parsedNhcId = parseInt(nhcId, 10);

    if (
      isNaN(parsedNominationId) ||
      isNaN(parsedCandidateId) ||
      isNaN(parsedNhcId) ||
      !supporterCNIC
    ) {
      return res.status(400).json({
        message: "nominationId, candidateId, supporterCNIC and nhcId are required",
      });
    }

    const pool = await getPool();

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    // 1. Check nomination is active and not ended
    const activeNomination = await new sql.Request(transaction)
      .input("NominationId", sql.Int, parsedNominationId)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1
          Id,
          NHC_Id,
          NominationStartDate,
          NominationEndDate,
          ISNULL(IsEnded, 0) AS IsEnded
        FROM Nominations
        WHERE Id = @NominationId
          AND NHC_Id = @NHC_Id
          AND ISNULL(IsEnded, 0) = 0
          AND CAST(GETDATE() AS DATE)
              BETWEEN CAST(NominationStartDate AS DATE)
              AND CAST(NominationEndDate AS DATE)
      `);

    if (activeNomination.recordset.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        message: "Nomination is not active for this council",
      });
    }

    const nomination = activeNomination.recordset[0];

    // 2. Check supporter belongs to this council
    const membershipCheck = await new sql.Request(transaction)
      .input("SupporterCNIC", sql.VarChar, supporterCNIC)
      .input("NHC_Id", sql.Int, nomination.NHC_Id)
      .query(`
        SELECT TOP 1 Id
        FROM UserNHCs
        WHERE UserCNIC = @SupporterCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    if (membershipCheck.recordset.length === 0) {
      await transaction.rollback();
      return res.status(403).json({
        message: "You are not a member of this council",
      });
    }

    // 3. Check candidate/panel exists and is valid
    const candidateCheck = await new sql.Request(transaction)
      .input("CandidateId", sql.Int, parsedCandidateId)
      .input("NominationId", sql.Int, parsedNominationId)
      .input("NHC_Id", sql.Int, nomination.NHC_Id)
      .query(`
        SELECT TOP 1
          c.Id,
          c.CNIC,
          c.NHC_Id,
          c.NominationId,
          c.Status,
          c.PanelId,
          p.Status AS PanelStatus
        FROM Candidates c
        INNER JOIN Panels p 
          ON c.PanelId = p.Id
        WHERE c.Id = @CandidateId
          AND c.NominationId = @NominationId
          AND c.NHC_Id = @NHC_Id
          AND c.Status IN ('Pending', 'Approved')
          AND LOWER(p.Status) = 'approved'
      `);

    if (candidateCheck.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({
        message: "Candidate not found in this nomination",
      });
    }

    const candidate = candidateCheck.recordset[0];

    // 4. Check candidate belongs to this council
    const candidateMembershipCheck = await new sql.Request(transaction)
      .input("CandidateCNIC", sql.VarChar, candidate.CNIC)
      .input("NHC_Id", sql.Int, nomination.NHC_Id)
      .query(`
        SELECT TOP 1 Id
        FROM UserNHCs
        WHERE UserCNIC = @CandidateCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    if (candidateMembershipCheck.recordset.length === 0) {
      await transaction.rollback();
      return res.status(403).json({
        message: "Candidate does not belong to this council",
      });
    }

    // 5. NEW RULE: panel member cannot support their own panel
    const ownPanelSupportCheck = await new sql.Request(transaction)
      .input("PanelId", sql.Int, candidate.PanelId)
      .input("SupporterCNIC", sql.VarChar, supporterCNIC)
      .query(`
        SELECT TOP 1 Id
        FROM PanelMembers
        WHERE PanelId = @PanelId
          AND CNIC = @SupporterCNIC
          AND LOWER(InviteStatus) = 'accepted'
      `);

    if (ownPanelSupportCheck.recordset.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        message: "You cannot support your own panel",
      });
    }

    // 6. Prevent duplicate support in same nomination
    const duplicateCheck = await new sql.Request(transaction)
      .input("NominationId", sql.Int, parsedNominationId)
      .input("SupporterCNIC", sql.VarChar, supporterCNIC)
      .query(`
        SELECT TOP 1 Id
        FROM CandidateSupports
        WHERE NominationId = @NominationId
          AND SupporterCNIC = @SupporterCNIC
      `);

    if (duplicateCheck.recordset.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        message: "You have already supported a panel in this nomination",
      });
    }

    // 7. Insert support
    await new sql.Request(transaction)
      .input("CandidateId", sql.Int, parsedCandidateId)
      .input("NominationId", sql.Int, parsedNominationId)
      .input("SupporterCNIC", sql.VarChar, supporterCNIC)
      .input("NHC_Id", sql.Int, nomination.NHC_Id)
      .input("NominationEndDate", sql.DateTime, nomination.NominationEndDate)
      .query(`
        INSERT INTO CandidateSupports
        (
          CandidateId,
          NominationId,
          SupporterCNIC,
          NHC_Id,
          NominationEndDate,
          CreatedDate
        )
        VALUES
        (
          @CandidateId,
          @NominationId,
          @SupporterCNIC,
          @NHC_Id,
          @NominationEndDate,
          GETDATE()
        )
      `);

    // 8. Recount supports
    const voteCountResult = await new sql.Request(transaction)
      .input("CandidateId", sql.Int, parsedCandidateId)
      .input("NominationId", sql.Int, parsedNominationId)
      .query(`
        SELECT COUNT(*) AS TotalSupports
        FROM CandidateSupports
        WHERE CandidateId = @CandidateId
          AND NominationId = @NominationId
      `);

    const totalSupports = voteCountResult.recordset[0].TotalSupports;

    let newStatus = "Pending";
    let isEligible = 0;

    if (totalSupports >= 10) {
      newStatus = "Approved";
      isEligible = 1;
    }

    await new sql.Request(transaction)
      .input("CandidateId", sql.Int, parsedCandidateId)
      .input("TotalVotes", sql.Int, totalSupports)
      .input("Status", sql.VarChar, newStatus)
      .input("IsEligible", sql.Bit, isEligible)
      .query(`
        UPDATE Candidates
        SET TotalVotes = @TotalVotes,
            Status = @Status,
            IsEligible = @IsEligible
        WHERE Id = @CandidateId
      `);

    await transaction.commit();

    return res.status(200).json({
      message:
        totalSupports >= 10
          ? "Support submitted. This panel is now approved for election."
          : "Support submitted successfully.",
      totalSupports,
      isEligible,
      status: newStatus,
      candidateId: parsedCandidateId,
    });
  } catch (error) {
    console.error("supportCandidate error:", error);

    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    return res.status(500).json({
      message: error.message || "Server error",
    });
  }
};