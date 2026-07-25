const { sql, getPool } = require("../db");

// ================= CREATE COMMITTEE WITH 5 MEMBERS + HEAD =================
exports.createCommittee = async (req, res) => {
  let transaction;

  try {
    let { nhcId, nhcCode, committeeName, createdByCnic, members, committeeHeadCnic } = req.body;

    if ((!nhcId && !nhcCode) || !committeeName || !Array.isArray(members)) {
      return res.status(400).json({
        error: "nhcId/nhcCode, committeeName and members are required",
      });
    }

    if (members.length !== 5) {
      return res.status(400).json({
        error: "Exactly 5 members must be selected",
      });
    }

    const uniqueMembers = [...new Set(members)];
    if (uniqueMembers.length !== 5) {
      return res.status(400).json({
        error: "Duplicate members are not allowed",
      });
    }

    if (!committeeHeadCnic) {
      return res.status(400).json({
        error: "Committee head is required",
      });
    }

    if (!uniqueMembers.includes(committeeHeadCnic)) {
      return res.status(400).json({
        error: "Committee head must be one of the selected members",
      });
    }

    // support both nhcId and nhcCode
    if (!nhcId && nhcCode) {
      if (typeof nhcCode === "string") {
        const code = nhcCode.trim().toLowerCase();
        if (code.startsWith("nhc-")) {
          nhcId = parseInt(code.split("-")[1], 10);
        } else {
          nhcId = parseInt(code, 10);
        }
      }
    }

    nhcId = parseInt(nhcId, 10);

    if (isNaN(nhcId)) {
      return res.status(400).json({
        error: "Invalid NHC Id",
      });
    }

    const pool = await getPool();
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const committeeResult = await new sql.Request(transaction)
      .input("NHC_Id", sql.Int, nhcId)
      .input("CommitteeName", sql.NVarChar, committeeName)
      .input("CreatedByCNIC", sql.NVarChar, createdByCnic || null)
      .query(`
        INSERT INTO Committees (NHC_Id, CommitteeName, CreatedByCNIC, CreatedDate)
        OUTPUT INSERTED.Id
        VALUES (@NHC_Id, @CommitteeName, @CreatedByCNIC, GETDATE())
      `);

    const committeeId = committeeResult.recordset[0].Id;

    for (const memberCnic of uniqueMembers) {
      await new sql.Request(transaction)
        .input("CommitteeId", sql.Int, committeeId)
        .input("MemberCNIC", sql.NVarChar, memberCnic)
        .input("IsHead", sql.Bit, memberCnic === committeeHeadCnic ? 1 : 0)
        .query(`
          INSERT INTO CommitteeMembers (CommitteeId, MemberCNIC, IsHead, CreatedDate)
          VALUES (@CommitteeId, @MemberCNIC, @IsHead, GETDATE())
        `);
    }

    await transaction.commit();

    res.status(201).json({
      message: "Committee created successfully",
      committeeId,
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("createCommittee error:", error);
    res.status(500).json({ error: error.message || "Failed to create committee" });
  }
};

// ================= GET COMMITTEES BY NHC =================
exports.getCommitteesByNhc = async (req, res) => {
  try {
    let { nhcId } = req.params;
    const pool = await getPool();

    nhcId = parseInt(nhcId, 10);

    if (isNaN(nhcId)) {
      return res.status(400).json({ error: "Invalid NHC Id" });
    }

    const result = await pool
      .request()
      .input("NHC_Id", sql.Int, nhcId)
      .query(`
        SELECT
          c.Id AS id,
          c.CommitteeName AS committeeName,
          c.NHC_Id AS nhcId,
          c.CreatedByCNIC AS createdByCnic,
          c.CreatedDate AS createdDate,
          head.MemberCNIC AS committeeHeadCnic,
          u.FirstName + ' ' + u.LastName AS committeeHeadName
        FROM Committees c
        LEFT JOIN CommitteeMembers head
          ON c.Id = head.CommitteeId AND head.IsHead = 1
        LEFT JOIN Users u
          ON head.MemberCNIC = u.CNIC
        WHERE c.NHC_Id = @NHC_Id
        ORDER BY c.Id DESC
      `);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("getCommitteesByNhc error:", error);
    res.status(500).json({ error: "Failed to fetch committees" });
  }
};

// ================= GET MEMBERS OF COMMITTEE =================
exports.getCommitteeMembers = async (req, res) => {
  try {
    const { committeeId } = req.params;
    const pool = await getPool();

    const parsedCommitteeId = parseInt(committeeId, 10);

    if (isNaN(parsedCommitteeId)) {
      return res.status(400).json({ error: "Invalid Committee Id" });
    }

    const result = await pool
      .request()
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .query(`
        SELECT
          m.Id AS id,
          m.MemberCNIC AS memberCnic,
          u.FirstName + ' ' + u.LastName AS memberName,
          m.IsHead AS isHead,
          m.CreatedDate AS createdDate
        FROM CommitteeMembers m
        INNER JOIN Users u ON m.MemberCNIC = u.CNIC
        WHERE m.CommitteeId = @CommitteeId
        ORDER BY m.IsHead DESC, m.Id ASC
      `);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("getCommitteeMembers error:", error);
    res.status(500).json({ error: "Failed to fetch members" });
  }
};

// ================= GET USER COMMITTEE =================
// ================= GET ALL USER COMMITTEES =================
exports.getMyCommittees = async (req, res) => {
  try {
    const { cnic } = req.params;

    if (!cnic) {
      return res.status(400).json({
        error: "CNIC is required",
      });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input("MemberCNIC", sql.NVarChar, cnic)
      .query(`
        SELECT
          c.Id AS committeeId,
          c.CommitteeName AS committeeName,
          c.NHC_Id AS nhcId,
          c.CreatedByCNIC AS createdByCnic,
          c.CreatedDate AS createdDate,
          cm.IsHead AS isHead
        FROM CommitteeMembers cm
        INNER JOIN Committees c ON cm.CommitteeId = c.Id
        WHERE cm.MemberCNIC = @MemberCNIC
        ORDER BY c.Id DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    console.error("getMyCommittees error:", error);
    res.status(500).json({ error: "Failed to fetch user committees" });
  }
};
// ================= CALL COMMITTEE MEETING =================
// ================= CALL COMMITTEE MEETING =================
exports.callMeeting = async (req, res) => {
  let transaction;

  try {
    const {
      complaintId,
      committeeId,
      headCnic,
      meetingDate,
      meetingTime,
      meetingLocation,
      committeeMessage,
      againstPersonMessage,
    } = req.body;

    if (
      !complaintId ||
      !committeeId ||
      !headCnic ||
      !meetingDate ||
      !meetingTime ||
      !meetingLocation ||
      !committeeMessage
    ) {
      return res.status(400).json({
        error: "All meeting fields are required",
      });
    }

    const parsedComplaintId = parseInt(complaintId, 10);
    const parsedCommitteeId = parseInt(committeeId, 10);

    if (isNaN(parsedComplaintId)) {
      return res.status(400).json({ error: "Invalid complaint id" });
    }

    if (isNaN(parsedCommitteeId)) {
      return res.status(400).json({ error: "Invalid committee id" });
    }

    const pool = await getPool();

    const complaintResult = await pool
      .request()
      .input("ComplaintId", sql.Int, parsedComplaintId)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .query(`
        SELECT TOP 1
          Id,
          Title,
          Detail,
          ComplaintType,
          AgainstPersonCNIC,
          AgainstPersonName,
          CommitteeId
        FROM Complaints
        WHERE Id = @ComplaintId
          AND CommitteeId = @CommitteeId
      `);

    if (complaintResult.recordset.length === 0) {
      return res.status(404).json({
        error: "Complaint not found for this committee",
      });
    }

    const complaint = complaintResult.recordset[0];

    const headCheck = await pool
      .request()
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .input("HeadCNIC", sql.NVarChar, headCnic)
      .query(`
        SELECT TOP 1 Id
        FROM CommitteeMembers
        WHERE CommitteeId = @CommitteeId
          AND MemberCNIC = @HeadCNIC
          AND IsHead = 1
      `);

    if (headCheck.recordset.length === 0) {
      return res.status(403).json({
        error: "Only committee head can call a meeting",
      });
    }

    const isAgainstPersonComplaint =
      complaint.ComplaintType === "AgainstPerson" &&
      complaint.AgainstPersonCNIC;

    if (
      isAgainstPersonComplaint &&
      (!againstPersonMessage || againstPersonMessage.trim() === "")
    ) {
      return res.status(400).json({
        error: "Message for against person is required",
      });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const meetingResult = await new sql.Request(transaction)
      .input("ComplaintId", sql.Int, parsedComplaintId)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .input("HeadCNIC", sql.NVarChar, headCnic)
      .input("MeetingDate", sql.Date, meetingDate)
      .input("MeetingTime", sql.NVarChar, meetingTime)
      .input("MeetingLocation", sql.NVarChar, meetingLocation)
      .input("CommitteeMessage", sql.NVarChar(sql.MAX), committeeMessage)
      .input(
        "AgainstPersonCNIC",
        sql.NVarChar,
        isAgainstPersonComplaint ? complaint.AgainstPersonCNIC : null
      )
      .input(
        "AgainstPersonName",
        sql.NVarChar,
        isAgainstPersonComplaint ? complaint.AgainstPersonName : null
      )
      .input(
        "AgainstPersonMessage",
        sql.NVarChar(sql.MAX),
        isAgainstPersonComplaint ? againstPersonMessage.trim() : null
      )
      .query(`
        INSERT INTO CommitteeMeetingCalls
        (
          ComplaintId,
          CommitteeId,
          HeadCNIC,
          MeetingDate,
          MeetingTime,
          MeetingLocation,
          CommitteeMessage,
          AgainstPersonCNIC,
          AgainstPersonName,
          AgainstPersonMessage,
          Status,
          CreatedDate
        )
        OUTPUT INSERTED.Id
        VALUES
        (
          @ComplaintId,
          @CommitteeId,
          @HeadCNIC,
          @MeetingDate,
          @MeetingTime,
          @MeetingLocation,
          @CommitteeMessage,
          @AgainstPersonCNIC,
          @AgainstPersonName,
          @AgainstPersonMessage,
          'Called',
          GETDATE()
        )
      `);

    const meetingCallId = meetingResult.recordset[0].Id;

    // This includes the committee head too because head is also a committee member.
    const membersResult = await new sql.Request(transaction)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .query(`
        SELECT DISTINCT MemberCNIC
        FROM CommitteeMembers
        WHERE CommitteeId = @CommitteeId
      `);

    const committeeNotice =
      `Committee Meeting Called\n\n` +
      `Complaint: ${complaint.Title}\n` +
      `Date: ${meetingDate}\n` +
      `Time: ${meetingTime}\n` +
      `Location: ${meetingLocation}\n\n` +
      `Message: ${committeeMessage}`;

    for (const member of membersResult.recordset) {
      await new sql.Request(transaction)
        .input("RecipientCNIC", sql.NVarChar, member.MemberCNIC)
        .input("Message", sql.NVarChar(sql.MAX), committeeNotice)
        .input("ComplaintId", sql.Int, parsedComplaintId)
        .input("Role", sql.NVarChar, "CommitteeMember")
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
            NULL,
            @Role,
            @ComplaintId,
            @IsRead
          )
        `);
    }

    let againstPersonNotified = false;

    if (isAgainstPersonComplaint) {
      const againstPersonNotice =
        `Meeting Notice Regarding Complaint Against You\n\n` +
        `Complaint: ${complaint.Title}\n` +
        `Date: ${meetingDate}\n` +
        `Time: ${meetingTime}\n` +
        `Location: ${meetingLocation}\n\n` +
        `Message: ${againstPersonMessage.trim()}`;

      await new sql.Request(transaction)
        .input("RecipientCNIC", sql.NVarChar, complaint.AgainstPersonCNIC)
        .input("Message", sql.NVarChar(sql.MAX), againstPersonNotice)
        .input("ComplaintId", sql.Int, parsedComplaintId)
        .input("Role", sql.NVarChar, "AgainstPerson")
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
            NULL,
            @Role,
            @ComplaintId,
            @IsRead
          )
        `);

      againstPersonNotified = true;
    }

    await new sql.Request(transaction)
      .input("ComplaintId", sql.Int, parsedComplaintId)
      .query(`
        UPDATE Complaints
        SET Status = 'Meeting Called',
            UpdatedDate = GETDATE()
        WHERE Id = @ComplaintId
      `);

    await transaction.commit();

    return res.status(201).json({
      message: againstPersonNotified
        ? "Meeting called. Committee head, committee members, and against person notified."
        : "Meeting called. Committee head and committee members notified.",
      meetingCallId,
      totalMembersNotified: membersResult.recordset.length,
      againstPersonNotified,
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("callMeeting error:", error);

    return res.status(500).json({
      error: error.message || "Failed to call meeting",
    });
  }
};

// ================= GET LATEST MEETING CALL BY COMPLAINT =================
exports.getLatestMeetingCallByComplaint = async (req, res) => {
  try {
    const { complaintId } = req.params;

    const parsedComplaintId = parseInt(complaintId, 10);

    if (isNaN(parsedComplaintId)) {
      return res.status(400).json({ error: "Invalid complaint id" });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input("ComplaintId", sql.Int, parsedComplaintId)
      .query(`
        SELECT TOP 1
          Id AS id,
          ComplaintId AS complaintId,
          CommitteeId AS committeeId,
          HeadCNIC AS headCnic,
          MeetingDate AS meetingDate,
          MeetingTime AS meetingTime,
          MeetingLocation AS meetingLocation,
          CommitteeMessage AS committeeMessage,
          AgainstPersonCNIC AS againstPersonCnic,
          AgainstPersonName AS againstPersonName,
          AgainstPersonMessage AS againstPersonMessage,
          Status AS status,
          CreatedDate AS createdDate
        FROM CommitteeMeetingCalls
        WHERE ComplaintId = @ComplaintId
        ORDER BY Id DESC
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        error: "No meeting call found for this complaint",
      });
    }

    return res.status(200).json(result.recordset[0]);
  } catch (error) {
    console.error("getLatestMeetingCallByComplaint error:", error);
    return res.status(500).json({
      error: error.message || "Failed to fetch latest meeting call",
    });
  }
};
// ================= RAISE MONEY REQUEST =================
// ================= RAISE MONEY REQUEST =================
exports.createRaiseMoneyRequest = async (req, res) => {
  let transaction;

  try {
    const {
      nhcId,
      committeeId,
      createdByCnic,
      title,
      requiredAmount,
      accountNumber,
      detail,
    } = req.body;

    if (
      !nhcId ||
      !committeeId ||
      !createdByCnic ||
      !title ||
      !requiredAmount ||
      !accountNumber
    ) {
      return res.status(400).json({
        error:
          "nhcId, committeeId, createdByCnic, title, requiredAmount and accountNumber are required",
      });
    }

    const parsedNhcId = parseInt(nhcId, 10);
    const parsedCommitteeId = parseInt(committeeId, 10);
    const cleanAmount = parseFloat(requiredAmount);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({ error: "Invalid nhcId" });
    }

    if (isNaN(parsedCommitteeId)) {
      return res.status(400).json({ error: "Invalid committeeId" });
    }

    if (isNaN(cleanAmount) || cleanAmount <= 0) {
      return res.status(400).json({ error: "Invalid required amount" });
    }

    const pool = await getPool();

    // 1. Check committee exists in this council
    const committeeCheck = await pool
      .request()
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1
          Id,
          CommitteeName,
          NHC_Id
        FROM Committees
        WHERE Id = @CommitteeId
          AND NHC_Id = @NHC_Id
      `);

    if (committeeCheck.recordset.length === 0) {
      return res.status(404).json({
        error: "Committee not found for this council",
      });
    }

    const committee = committeeCheck.recordset[0];

    // 2. Only committee head can raise money
    const headCheck = await pool
      .request()
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .input("CreatedByCNIC", sql.VarChar, createdByCnic)
      .query(`
        SELECT TOP 1 Id
        FROM CommitteeMembers
        WHERE CommitteeId = @CommitteeId
          AND MemberCNIC = @CreatedByCNIC
          AND IsHead = 1
      `);

    if (headCheck.recordset.length === 0) {
      return res.status(403).json({
        error: "Only committee head can raise money request",
      });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    // 3. Save raise money request
    const raiseResult = await new sql.Request(transaction)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .input("CreatedByCNIC", sql.VarChar, createdByCnic)
      .input("Title", sql.NVarChar, title.trim())
      .input("RequiredAmount", sql.Decimal(18, 2), cleanAmount)
      .input("AccountNumber", sql.NVarChar, accountNumber.trim())
      .input(
        "Detail",
        sql.NVarChar(sql.MAX),
        detail && detail.trim() !== "" ? detail.trim() : null
      )
      .query(`
        INSERT INTO RaiseMoneyRequests
        (
          NHC_Id,
          CommitteeId,
          CreatedByCNIC,
          Title,
          RequiredAmount,
          AccountNumber,
          Detail,
          Status,
          CreatedDate
        )
        OUTPUT INSERTED.Id
        VALUES
        (
          @NHC_Id,
          @CommitteeId,
          @CreatedByCNIC,
          @Title,
          @RequiredAmount,
          @AccountNumber,
          @Detail,
          'Active',
          GETDATE()
        )
      `);

    const raiseMoneyRequestId = raiseResult.recordset[0].Id;

    // 4. Get all council members from UserNHCs
    const usersResult = await new sql.Request(transaction)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT DISTINCT UserCNIC AS CNIC
        FROM UserNHCs
        WHERE NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    const notificationMessage =
      `Raise Money Request\n\n` +
      `Committee: ${committee.CommitteeName}\n` +
      `Title: ${title.trim()}\n` +
      `Required Amount: Rs. ${cleanAmount}\n` +
      `Account Number: ${accountNumber.trim()}\n\n` +
      `Detail: ${
        detail && detail.trim() !== "" ? detail.trim() : "No detail provided"
      }`;

    // 5. Send notification to all users in that council
    for (const user of usersResult.recordset) {
      await new sql.Request(transaction)
        .input("RecipientCNIC", sql.VarChar, user.CNIC)
        .input("Message", sql.NVarChar(sql.MAX), notificationMessage)
        .input("Role", sql.NVarChar, "CouncilMember")
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
            NULL,
            @Role,
            NULL,
            @IsRead
          )
        `);
    }

    await transaction.commit();

    return res.status(201).json({
      message: "Raise money request created and sent to council members",
      raiseMoneyRequestId,
      totalUsersNotified: usersResult.recordset.length,
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("createRaiseMoneyRequest error:", error);

    return res.status(500).json({
      error: error.message || "Failed to create raise money request",
    });
  }
};