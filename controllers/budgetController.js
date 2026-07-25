const { sql, getPool } = require("../db");

function isUrgentValue(value) {
  return value === true || value === 1 || value === "1";
}

// ================= URGENT FIRST HELPER =================
async function checkUrgentBudgetFirst(pool, complaintId, committeeId) {
  const currentResult = await pool
    .request()
    .input("ComplaintId", sql.Int, complaintId)
    .query(`
      SELECT TOP 1
        Id,
        CommitteeId,
        IsUrgent,
        Status
      FROM Complaints
      WHERE Id = @ComplaintId
    `);

  if (currentResult.recordset.length === 0) {
    return {
      allowed: false,
      status: 404,
      error: "Complaint not found",
    };
  }

  const currentComplaint = currentResult.recordset[0];

  // If current complaint is urgent, allow it
  if (isUrgentValue(currentComplaint.IsUrgent)) {
    return { allowed: true };
  }

  // If current complaint is normal, check if same committee has urgent unfinished complaint
  const urgentResult = await pool
    .request()
    .input("CommitteeId", sql.Int, committeeId)
    .query(`
      SELECT TOP 1
        Id,
        Title,
        Status
      FROM Complaints
      WHERE CommitteeId = @CommitteeId
        AND IsUrgent = 1
        AND Status NOT IN (
          'Completed',
          'Resolved',
          'Budget Released',
          'Budget Rejected By President',
          'Budget Rejected By Treasurer'
        )
      ORDER BY CreatedDate ASC
    `);

  if (urgentResult.recordset.length > 0) {
    return {
      allowed: false,
      status: 400,
      error: "Committee must request/handle budget for urgent complaints first",
      urgentComplaint: urgentResult.recordset[0],
    };
  }

  return { allowed: true };
}

// ================= COMMITTEE CREATE BUDGET REQUEST =================
exports.createBudgetRequest = async (req, res) => {
  try {
    console.log("createBudgetRequest params:", req.params);
    console.log("createBudgetRequest body:", req.body);

    const { id } = req.params;
    const { committeeId, requestedByCnic, requestedAmount, requestDetail } =
      req.body;

    if (!committeeId || !requestedByCnic || !requestedAmount) {
      return res.status(400).json({
        error: "committeeId, requestedByCnic and requestedAmount are required",
        received: req.body,
      });
    }

    const complaintId = parseInt(id, 10);
    const parsedCommitteeId = parseInt(committeeId, 10);
    const cleanAmount = parseFloat(requestedAmount);

    if (isNaN(complaintId)) {
      return res.status(400).json({ error: "Invalid complaint id" });
    }

    if (isNaN(parsedCommitteeId)) {
      return res.status(400).json({ error: "Invalid committee id" });
    }

    if (isNaN(cleanAmount) || cleanAmount <= 0) {
      return res.status(400).json({
        error: "Invalid requested amount",
        receivedAmount: requestedAmount,
      });
    }

    const pool = await getPool();

    const complaintCheck = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .query(`
        SELECT TOP 1 
          Id, 
          CommitteeId, 
          Status,
          IsUrgent
        FROM Complaints
        WHERE Id = @ComplaintId
          AND CommitteeId = @CommitteeId
      `);

    if (complaintCheck.recordset.length === 0) {
      return res.status(404).json({
        error: "Complaint not found for this committee",
        complaintId,
        committeeId: parsedCommitteeId,
      });
    }

    const complaint = complaintCheck.recordset[0];

    // Urgent-first rule for committee budget request
    const urgentCheck = await checkUrgentBudgetFirst(
      pool,
      complaintId,
      parsedCommitteeId
    );

    if (!urgentCheck.allowed) {
      return res.status(urgentCheck.status).json({
        error: urgentCheck.error,
        urgentComplaint: urgentCheck.urgentComplaint,
      });
    }

    const existingBudget = await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        SELECT TOP 1 Id, Status
        FROM ComplaintBudgetRequests
        WHERE ComplaintId = @ComplaintId
          AND Status IN (
            'Pending President Approval',
            'Approved By President',
            'Released By Treasurer'
          )
        ORDER BY Id DESC
      `);

    if (existingBudget.recordset.length > 0) {
      return res.status(400).json({
        error: "A budget request already exists for this complaint",
      });
    }

    await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .input("CommitteeId", sql.Int, parsedCommitteeId)
      .input("RequestedByCNIC", sql.NVarChar, requestedByCnic.toString())
      .input("RequestedAmount", sql.Decimal(18, 2), cleanAmount)
      .input(
        "RequestDetail",
        sql.NVarChar(sql.MAX),
        requestDetail && requestDetail.trim() !== ""
          ? requestDetail.trim()
          : null
      )
      .query(`
        INSERT INTO ComplaintBudgetRequests
        (
          ComplaintId,
          CommitteeId,
          RequestedByCNIC,
          RequestedAmount,
          RequestDetail,
          Status,
          CreatedDate
        )
        VALUES
        (
          @ComplaintId,
          @CommitteeId,
          @RequestedByCNIC,
          @RequestedAmount,
          @RequestDetail,
          'Pending President Approval',
          GETDATE()
        )
      `);

    await pool
      .request()
      .input("ComplaintId", sql.Int, complaintId)
      .query(`
        UPDATE Complaints
        SET Status = 'Budget Requested',
            UpdatedDate = GETDATE()
        WHERE Id = @ComplaintId
      `);

    return res.status(201).json({
      message: "Budget request sent to president for approval",
      complaintId,
      committeeId: parsedCommitteeId,
      isUrgent: complaint.IsUrgent,
    });
  } catch (error) {
    console.error("createBudgetRequest error:", error);

    return res.status(500).json({
      error: error.message || "Failed to create budget request",
    });
  }
};

// ================= GET ALL BUDGET REQUESTS =================
exports.getAllBudgetRequests = async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        b.Id AS id,
        b.ComplaintId AS complaintId,
        b.CommitteeId AS committeeId,
        b.RequestedByCNIC AS requestedByCnic,
        b.RequestedAmount AS requestedAmount,
        b.RequestDetail AS requestDetail,
        b.Status AS status,
        b.TreasurerRemarks AS treasurerRemarks,
        b.PresidentRemarks AS presidentRemarks,
        b.ApprovedAmount AS approvedAmount,
        b.CreatedDate AS createdDate,
        b.UpdatedDate AS updatedDate,

        c.Title AS complaintTitle,
        c.Status AS complaintStatus,
        c.NHC_Id AS nhcId,
        c.IsUrgent AS isUrgent,

        cm.CommitteeName AS committeeName,

        tf.TotalAmount AS treasuryTotalAmount,
        tf.ReleasedAmount AS treasuryReleasedAmount,
        tf.AvailableAmount AS treasuryAvailableAmount
      FROM ComplaintBudgetRequests b
      INNER JOIN Complaints c ON b.ComplaintId = c.Id
      LEFT JOIN Committees cm ON b.CommitteeId = cm.Id
      LEFT JOIN CouncilTreasuryFunds tf ON c.NHC_Id = tf.NHC_Id
      ORDER BY
        c.IsUrgent DESC,
        b.CreatedDate ASC
    `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    console.error("getAllBudgetRequests error:", error);

    return res.status(500).json({
      error: error.message || "Failed to fetch budget requests",
    });
  }
};

// ================= GET BUDGET REQUESTS BY COMPLAINT =================
exports.getBudgetRequestByComplaint = async (req, res) => {
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
        SELECT
          b.Id AS id,
          b.ComplaintId AS complaintId,
          b.CommitteeId AS committeeId,
          b.RequestedByCNIC AS requestedByCnic,
          b.RequestedAmount AS requestedAmount,
          b.RequestDetail AS requestDetail,
          b.Status AS status,
          b.TreasurerRemarks AS treasurerRemarks,
          b.PresidentRemarks AS presidentRemarks,
          b.ApprovedAmount AS approvedAmount,
          b.CreatedDate AS createdDate,
          b.UpdatedDate AS updatedDate,

          c.NHC_Id AS nhcId,
          c.Title AS complaintTitle,
          c.Status AS complaintStatus,
          c.IsUrgent AS isUrgent,

          cm.CommitteeName AS committeeName
        FROM ComplaintBudgetRequests b
        INNER JOIN Complaints c ON b.ComplaintId = c.Id
        LEFT JOIN Committees cm ON b.CommitteeId = cm.Id
        WHERE b.ComplaintId = @ComplaintId
        ORDER BY b.Id DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    console.error("getBudgetRequestByComplaint error:", error);

    return res.status(500).json({
      error: error.message || "Failed to fetch complaint budget request",
    });
  }
};

// ================= PRESIDENT APPROVE / REJECT BUDGET =================
exports.presidentReviewBudgetRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, approvedAmount, presidentRemarks } = req.body;

    const requestId = parseInt(id, 10);

    if (isNaN(requestId)) {
      return res.status(400).json({ error: "Invalid budget request id" });
    }

    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }

    const pool = await getPool();

    const budgetResult = await pool
      .request()
      .input("Id", sql.Int, requestId)
      .query(`
        SELECT
          b.Id,
          b.ComplaintId,
          b.RequestedAmount,
          b.Status,
          c.NHC_Id,
          c.IsUrgent
        FROM ComplaintBudgetRequests b
        INNER JOIN Complaints c ON b.ComplaintId = c.Id
        WHERE b.Id = @Id
      `);

    if (budgetResult.recordset.length === 0) {
      return res.status(404).json({ error: "Budget request not found" });
    }

    const budget = budgetResult.recordset[0];

    if (budget.Status !== "Pending President Approval") {
      return res.status(400).json({
        error: "Only pending president approval requests can be reviewed",
      });
    }

    // Urgent-first rule for president
    if (!isUrgentValue(budget.IsUrgent)) {
      const urgentBudgetResult = await pool
        .request()
        .input("NHC_Id", sql.Int, budget.NHC_Id)
        .query(`
          SELECT TOP 1
            b.Id,
            c.Title
          FROM ComplaintBudgetRequests b
          INNER JOIN Complaints c ON b.ComplaintId = c.Id
          WHERE c.NHC_Id = @NHC_Id
            AND c.IsUrgent = 1
            AND b.Status = 'Pending President Approval'
          ORDER BY b.CreatedDate ASC
        `);

      if (urgentBudgetResult.recordset.length > 0) {
        return res.status(400).json({
          error: "President must review urgent budget requests first",
          urgentBudgetRequest: urgentBudgetResult.recordset[0],
        });
      }
    }

    let newBudgetStatus;
    let newComplaintStatus;
    let finalApprovedAmount = null;

    if (status === "Approved" || status === "Approved By President") {
      newBudgetStatus = "Approved By President";
      newComplaintStatus = "Budget Approved";
      finalApprovedAmount =
        approvedAmount && !isNaN(parseFloat(approvedAmount))
          ? parseFloat(approvedAmount)
          : parseFloat(budget.RequestedAmount);
    } else if (status === "Rejected" || status === "Rejected By President") {
      newBudgetStatus = "Rejected By President";
      newComplaintStatus = "Returned to Committee";
    } else {
      return res.status(400).json({
        error: "Invalid status. Use Approved or Rejected",
        receivedStatus: status,
      });
    }

    await pool
      .request()
      .input("Id", sql.Int, requestId)
      .input("Status", sql.NVarChar, newBudgetStatus)
      .input("ApprovedAmount", sql.Decimal(18, 2), finalApprovedAmount)
      .input("PresidentRemarks", sql.NVarChar(sql.MAX), presidentRemarks || null)
      .query(`
        UPDATE ComplaintBudgetRequests
        SET Status = @Status,
            ApprovedAmount = @ApprovedAmount,
            PresidentRemarks = @PresidentRemarks,
            UpdatedDate = GETDATE()
        WHERE Id = @Id
      `);

    await pool
      .request()
      .input("ComplaintId", sql.Int, budget.ComplaintId)
      .input("ComplaintStatus", sql.NVarChar, newComplaintStatus)
      .query(`
        UPDATE Complaints
        SET Status = @ComplaintStatus,
            UpdatedDate = GETDATE()
        WHERE Id = @ComplaintId
      `);

    return res.status(200).json({
      message:
        newBudgetStatus === "Approved By President"
          ? "Budget approved by president and sent to treasurer"
          : "Budget rejected by president",
      isUrgent: budget.IsUrgent,
    });
  } catch (error) {
    console.error("presidentReviewBudgetRequest error:", error);

    return res.status(500).json({
      error: error.message || "Failed to review budget request",
    });
  }
};

// ================= TREASURER RELEASE / REJECT BUDGET =================
exports.treasurerReviewBudgetRequest = async (req, res) => {
  let transaction;

  try {
    const { id } = req.params;
    const { status, treasurerRemarks, releasedByCnic } = req.body;

    const requestId = parseInt(id, 10);

    if (isNaN(requestId)) {
      return res.status(400).json({
        error: "Invalid budget request id",
      });
    }

    if (!status) {
      return res.status(400).json({
        error: "Status is required",
      });
    }

    if (!releasedByCnic || releasedByCnic.toString().trim() === "") {
      return res.status(400).json({
        error: "releasedByCnic is required",
      });
    }

    const cleanStatus = status.toString().trim();

    const isRelease =
      cleanStatus === "Released" || cleanStatus === "Released By Treasurer";

    const isReject =
      cleanStatus === "Rejected" || cleanStatus === "Rejected By Treasurer";

    if (!isRelease && !isReject) {
      return res.status(400).json({
        error: "Invalid status. Use Released or Rejected",
        receivedStatus: status,
      });
    }

    if (isReject && (!treasurerRemarks || treasurerRemarks.trim() === "")) {
      return res.status(400).json({
        error: "Rejection reason is required",
      });
    }

    const pool = await getPool();

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const budgetResult = await new sql.Request(transaction)
      .input("Id", sql.Int, requestId)
      .query(`
        SELECT TOP 1
          b.Id,
          b.ComplaintId,
          b.CommitteeId,
          b.Status,
          b.RequestedAmount,
          b.ApprovedAmount,
          c.NHC_Id,
          c.IsUrgent
        FROM ComplaintBudgetRequests b
        INNER JOIN Complaints c ON b.ComplaintId = c.Id
        WHERE b.Id = @Id
      `);

    if (budgetResult.recordset.length === 0) {
      await transaction.rollback();

      return res.status(404).json({
        error: "Budget request not found",
      });
    }

    const budget = budgetResult.recordset[0];

    if (budget.Status !== "Approved By President") {
      await transaction.rollback();

      return res.status(400).json({
        error:
          "Only president approved budget requests can be reviewed by treasurer",
        currentStatus: budget.Status,
      });
    }

    // ================= URGENT-FIRST CHECK FOR TREASURER =================
    // If this request is normal, treasurer must first release/reject
    // any urgent budget request in the same NHC.
    if (!isUrgentValue(budget.IsUrgent)) {
      const urgentBudgetResult = await new sql.Request(transaction)
        .input("NHC_Id", sql.Int, budget.NHC_Id)
        .query(`
          SELECT TOP 1
            b.Id,
            b.ComplaintId,
            b.Status,
            c.Title,
            c.IsUrgent
          FROM ComplaintBudgetRequests b
          INNER JOIN Complaints c ON b.ComplaintId = c.Id
          WHERE c.NHC_Id = @NHC_Id
            AND c.IsUrgent = 1
            AND b.Status = 'Approved By President'
          ORDER BY b.CreatedDate ASC
        `);

      if (urgentBudgetResult.recordset.length > 0) {
        await transaction.rollback();

        return res.status(400).json({
          error: "Urgent budget requests must be handled first",
          urgentBudgetRequest: urgentBudgetResult.recordset[0],
        });
      }
    }

    // ================= TREASURER REJECT =================
    if (isReject) {
      await new sql.Request(transaction)
        .input("Id", sql.Int, requestId)
        .input("Status", sql.NVarChar, "Rejected By Treasurer")
        .input(
          "TreasurerRemarks",
          sql.NVarChar(sql.MAX),
          treasurerRemarks.trim()
        )
        .query(`
          UPDATE ComplaintBudgetRequests
          SET Status = @Status,
              TreasurerRemarks = @TreasurerRemarks,
              UpdatedDate = GETDATE()
          WHERE Id = @Id
        `);

      await new sql.Request(transaction)
        .input("ComplaintId", sql.Int, budget.ComplaintId)
        .input("ComplaintStatus", sql.NVarChar, "Budget Rejected By Treasurer")
        .query(`
          UPDATE Complaints
          SET Status = @ComplaintStatus,
              UpdatedDate = GETDATE()
          WHERE Id = @ComplaintId
        `);

      await transaction.commit();

      return res.status(200).json({
        message: "Budget rejected by treasurer",
        budgetRequestId: requestId,
        complaintId: budget.ComplaintId,
        isUrgent: budget.IsUrgent,
      });
    }

    // ================= TREASURER RELEASE =================
    const releaseAmount = parseFloat(
      budget.ApprovedAmount || budget.RequestedAmount
    );

    if (isNaN(releaseAmount) || releaseAmount <= 0) {
      await transaction.rollback();

      return res.status(400).json({
        error: "Invalid approved/release amount",
      });
    }

    const treasuryResult = await new sql.Request(transaction)
      .input("NHC_Id", sql.Int, budget.NHC_Id)
      .query(`
        SELECT TOP 1
          Id,
          NHC_Id,
          TotalAmount,
          ReleasedAmount,
          AvailableAmount
        FROM CouncilTreasuryFunds
        WHERE NHC_Id = @NHC_Id
        ORDER BY Id DESC
      `);

    if (treasuryResult.recordset.length === 0) {
      await transaction.rollback();

      return res.status(404).json({
        error: "Treasury fund not found for this council",
      });
    }

    const treasury = treasuryResult.recordset[0];
    const availableAmount = parseFloat(treasury.AvailableAmount || 0);

    if (availableAmount < releaseAmount) {
      await transaction.rollback();

      return res.status(400).json({
        error: "Insufficient treasury balance",
        availableAmount,
        requiredAmount: releaseAmount,
      });
    }

    await new sql.Request(transaction)
      .input("TreasuryFundId", sql.Int, treasury.Id)
      .input("ReleaseAmount", sql.Decimal(18, 2), releaseAmount)
      .query(`
        UPDATE CouncilTreasuryFunds
        SET AvailableAmount = AvailableAmount - @ReleaseAmount,
            ReleasedAmount = ReleasedAmount + @ReleaseAmount,
            UpdatedDate = GETDATE()
        WHERE Id = @TreasuryFundId
      `);

    await new sql.Request(transaction)
      .input("TreasuryFundId", sql.Int, treasury.Id)
      .input("NHC_Id", sql.Int, budget.NHC_Id)
      .input("BudgetRequestId", sql.Int, requestId)
      .input("ComplaintId", sql.Int, budget.ComplaintId)
      .input("CommitteeId", sql.Int, budget.CommitteeId)
      .input("ReleasedByCNIC", sql.VarChar, releasedByCnic.toString())
      .input("ReleasedAmount", sql.Decimal(18, 2), releaseAmount)
      .input("Remarks", sql.NVarChar(sql.MAX), treasurerRemarks || null)
      .query(`
        INSERT INTO CouncilTreasuryFundReleases
        (
          TreasuryFundId,
          NHC_Id,
          BudgetRequestId,
          ComplaintId,
          CommitteeId,
          ReleasedByCNIC,
          ReleasedAmount,
          Remarks,
          CreatedDate
        )
        VALUES
        (
          @TreasuryFundId,
          @NHC_Id,
          @BudgetRequestId,
          @ComplaintId,
          @CommitteeId,
          @ReleasedByCNIC,
          @ReleasedAmount,
          @Remarks,
          GETDATE()
        )
      `);

    await new sql.Request(transaction)
      .input("Id", sql.Int, requestId)
      .input("Status", sql.NVarChar, "Released By Treasurer")
      .input("TreasurerRemarks", sql.NVarChar(sql.MAX), treasurerRemarks || null)
      .query(`
        UPDATE ComplaintBudgetRequests
        SET Status = @Status,
            TreasurerRemarks = @TreasurerRemarks,
            UpdatedDate = GETDATE()
        WHERE Id = @Id
      `);

    await new sql.Request(transaction)
      .input("ComplaintId", sql.Int, budget.ComplaintId)
      .input("ComplaintStatus", sql.NVarChar, "Budget Released")
      .query(`
        UPDATE Complaints
        SET Status = @ComplaintStatus,
            UpdatedDate = GETDATE()
        WHERE Id = @ComplaintId
      `);

    await transaction.commit();

    return res.status(200).json({
      message: "Budget released by treasurer",
      budgetRequestId: requestId,
      complaintId: budget.ComplaintId,
      releasedAmount: releaseAmount,
      treasuryFundId: treasury.Id,
      remainingBalance: availableAmount - releaseAmount,
      isUrgent: budget.IsUrgent,
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("treasurerReviewBudgetRequest error:", error);

    return res.status(500).json({
      error: error.message || "Failed to review budget request",
    });
  }
};
// ================= GET COUNCIL TREASURY FUND BY NHC ID =================
exports.getCouncilTreasuryFundByNhcId = async (req, res) => {
  try {
    const { nhcId } = req.params;
    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid NHC id",
      });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1
          Id AS id,
          NHC_Id AS nhcId,
          TotalAmount AS totalAmount,
          ReleasedAmount AS releasedAmount,
          AvailableAmount AS availableAmount,
          Description AS description,
          CreatedDate AS createdDate,
          UpdatedDate AS updatedDate
        FROM CouncilTreasuryFunds
        WHERE NHC_Id = @NHC_Id
        ORDER BY Id DESC
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No treasury fund found for this neighbourhood",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.recordset[0],
    });
  } catch (error) {
    console.error("getCouncilTreasuryFundByNhcId error:", error);

    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch council treasury fund",
    });
  }
};