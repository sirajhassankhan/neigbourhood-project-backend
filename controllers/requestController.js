const { sql, getPool } = require("../db");

// ================= GET ALL REQUESTS =================
exports.getAllRequests = async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT *
      FROM Requests
      ORDER BY CreatedDate DESC
    `);

    res.json(result.recordset);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};


// ================= GET ONLY PENDING =================
exports.getPendingRequests = async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT *
      FROM Requests
      WHERE Status = 'Pending'
      ORDER BY CreatedDate DESC
    `);

    res.json(result.recordset);

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};


// ================= APPROVE REQUEST =================
exports.approveRequest = async (req, res) => {
  try {
    const pool = await getPool();
    const { requestId, nhcId } = req.body;

    // 1️⃣ Get request
    const requestData = await pool.request()
      .input("Id", sql.Int, requestId)
      .query("SELECT * FROM Requests WHERE Id=@Id");

    if (requestData.recordset.length === 0) {
      return res.status(404).json({ error: "Request not found" });
    }

    const request = requestData.recordset[0];

    // 2️⃣ Update request status
    await pool.request()
      .input("Id", sql.Int, requestId)
      .input("AssignedNHC", sql.Int, nhcId)
      .query(`
        UPDATE Requests
        SET Status='Approved',
            AssignedNHC=@AssignedNHC
        WHERE Id=@Id
      `);

    // 3️⃣ Update User table NHC_Code
    await pool.request()
      .input("CNIC", sql.NVarChar, request.CNIC)
      .input("NHC_Code", sql.Int, nhcId)
      .query(`
        UPDATE Users
        SET NHC_Code=@NHC_Code
        WHERE CNIC=@CNIC
      `);

    res.json({ message: "Request approved and user updated" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
};


// ================= REJECT REQUEST =================
exports.rejectRequest = async (req, res) => {
  try {
    const pool = await getPool();
    const { requestId } = req.body;

    await pool.request()
      .input("Id", sql.Int, requestId)
      .query(`
        UPDATE Requests
        SET Status='Rejected'
        WHERE Id=@Id
      `);

    res.json({ message: "Request rejected" });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};
exports.getPendingCount = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query("SELECT COUNT(*) AS total FROM Requests WHERE Status='Pending'");

    res.json({ total: result.recordset[0].total });

  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
};
exports.approveChangeCouncil = async (req, res) => {
  try {
    const pool = await getPool();

    const { requestId, cnic, requestedCouncilId } = req.body;
    const newNHC = parseInt(requestedCouncilId);

    if (!requestId || !cnic || isNaN(newNHC)) {
      return res.status(400).json({
        success: false,
        error: "requestId, cnic and valid requestedCouncilId are required"
      });
    }

    // 🔹 Get current council FROM REQUEST
    const requestData = await pool.request()
      .input("Id", sql.Int, requestId)
      .query(`
        SELECT CurrentNHC
        FROM Requests
        WHERE Id = @Id
      `);

    if (requestData.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Request not found"
      });
    }

    const currentNHC = requestData.recordset[0].CurrentNHC;

    // 🔹 Deactivate ONLY the current council (not all)
    if (currentNHC) {
      await pool.request()
        .input("UserCNIC", sql.NVarChar, cnic)
        .input("CurrentNHC", sql.Int, currentNHC)
        .query(`
          UPDATE UserNHCs
          SET IsPrimary = 0,
              IsActive = 0
          WHERE UserCNIC = @UserCNIC
            AND NHC_Id = @CurrentNHC
        `);
    }

    // 🔹 Check if new council already exists
    const existing = await pool.request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .input("NHC_Id", sql.Int, newNHC)
      .query(`
        SELECT Id
        FROM UserNHCs
        WHERE UserCNIC = @UserCNIC
          AND NHC_Id = @NHC_Id
      `);

    if (existing.recordset.length > 0) {
      // 🔹 Reactivate + make primary
      await pool.request()
        .input("UserCNIC", sql.NVarChar, cnic)
        .input("NHC_Id", sql.Int, newNHC)
        .query(`
          UPDATE UserNHCs
          SET IsActive = 1,
              IsPrimary = 1
          WHERE UserCNIC = @UserCNIC
            AND NHC_Id = @NHC_Id
        `);
    } else {
      // 🔹 Insert new as primary
      await pool.request()
        .input("UserCNIC", sql.NVarChar, cnic)
        .input("NHC_Id", sql.Int, newNHC)
        .query(`
          INSERT INTO UserNHCs
          (UserCNIC, NHC_Id, IsPrimary, IsActive, JoinedDate)
          VALUES
          (@UserCNIC, @NHC_Id, 1, 1, GETDATE())
        `);
    }

    // 🔹 Update Users table (main council)
    await pool.request()
      .input("CNIC", sql.NVarChar, cnic)
      .input("NHC_Code", sql.NVarChar, `nhc-${newNHC}`)
      .query(`
        UPDATE Users
        SET NHC_Code = @NHC_Code
        WHERE CNIC = @CNIC
      `);

    // 🔹 Approve request
    await pool.request()
      .input("Id", sql.Int, requestId)
      .query(`
        UPDATE Requests
        SET Status = 'Approved'
        WHERE Id = @Id
      `);

    res.json({
      success: true,
      message: "Council changed successfully"
    });

  } catch (err) {
    console.error("approveChangeCouncil error:", err);
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};
exports.approveAddCouncil = async (req, res) => {
  try {
    const pool = await getPool();

    const { requestId, cnic, requestedCouncilId } = req.body;
    const newNHC = parseInt(requestedCouncilId);

    if (!requestId || !cnic || isNaN(newNHC)) {
      return res.status(400).json({
        success: false,
        error: "requestId, cnic and valid requestedCouncilId are required"
      });
    }

    const existing = await pool.request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .input("NHC_Id", sql.Int, newNHC)
      .query(`
        SELECT Id, IsActive
        FROM UserNHCs
        WHERE UserCNIC = @UserCNIC
          AND NHC_Id = @NHC_Id
      `);

    if (existing.recordset.length > 0) {
      if (existing.recordset[0].IsActive === true) {
        return res.status(400).json({
          success: false,
          error: "User already active in this council"
        });
      }

      await pool.request()
        .input("UserCNIC", sql.NVarChar, cnic)
        .input("NHC_Id", sql.Int, newNHC)
        .query(`
          UPDATE UserNHCs
          SET IsActive = 1,
              IsPrimary = 0,
              PositionId = NULL,
              Role = 'User'
          WHERE UserCNIC = @UserCNIC
            AND NHC_Id = @NHC_Id
        `);
    } else {
      await pool.request()
        .input("UserCNIC", sql.NVarChar, cnic)
        .input("NHC_Id", sql.Int, newNHC)
        .query(`
          INSERT INTO UserNHCs
          (UserCNIC, NHC_Id, IsPrimary, IsActive, JoinedDate, PositionId, Role)
          VALUES
          (@UserCNIC, @NHC_Id, 0, 1, GETDATE(), NULL, 'User')
        `);
    }

    await pool.request()
      .input("Id", sql.Int, requestId)
      .query(`
        UPDATE Requests
        SET Status = 'Approved'
        WHERE Id = @Id
      `);

    res.json({
      success: true,
      message: "User added to new council as normal user successfully"
    });

  } catch (err) {
    console.error("approveAddCouncil error:", err);
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};
exports.getUserCouncils = async (req, res) => {
  try {
    const pool = await getPool();
    const { cnic } = req.params;

    const result = await pool.request()
      .input("CNIC", sql.NVarChar, cnic)
      .query(`
        SELECT 
          un.Id,
          un.UserCNIC,
          un.NHC_Id,
          un.IsPrimary,
          un.IsActive,
          un.JoinedDate,
          un.PositionId,
          un.Role AS CouncilRole,
          nz.Name AS NHCName
        FROM UserNHCs un
        INNER JOIN NHC_Zones nz ON un.NHC_Id = nz.Id
        WHERE un.UserCNIC = @CNIC
          AND un.IsActive = 1
        ORDER BY un.IsPrimary DESC, nz.Name ASC
      `);

    res.json({
      success: true,
      councils: result.recordset
    });

  } catch (err) {
    console.error("getUserCouncils error:", err);
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};
// ================= CHANGE PRIMARY COUNCIL =================
// Used when user selects council after login
exports.changePrimaryCouncil = async (req, res) => {
  try {
    const pool = await getPool();

    const { cnic, nhcId } = req.body;
    const parsedNhcId = parseInt(nhcId, 10);

    if (!cnic || isNaN(parsedNhcId)) {
      return res.status(400).json({
        success: false,
        error: "cnic and valid nhcId are required",
      });
    }

    // 1. Check user belongs to this council
    const membershipCheck = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1
          un.Id,
          un.PositionId,
          un.Role,
          nz.Name AS NHCName
        FROM UserNHCs un
        INNER JOIN NHC_Zones nz ON un.NHC_Id = nz.Id
        WHERE un.UserCNIC = @UserCNIC
          AND un.NHC_Id = @NHC_Id
          AND un.IsActive = 1
      `);

    if (membershipCheck.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User is not active in this council",
      });
    }

    const selectedCouncil = membershipCheck.recordset[0];

    // 2. Remove primary from all active councils of this user
    await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .query(`
        UPDATE UserNHCs
        SET IsPrimary = 0
        WHERE UserCNIC = @UserCNIC
          AND IsActive = 1
      `);

    // 3. Set selected council as primary
    await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        UPDATE UserNHCs
        SET IsPrimary = 1
        WHERE UserCNIC = @UserCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    // 4. Update Users table for old compatibility
    await pool
      .request()
      .input("CNIC", sql.NVarChar, cnic)
      .input("NHC_Code", sql.NVarChar, `nhc-${parsedNhcId}`)
      .input("PositionId", sql.Int, selectedCouncil.PositionId)
      .input("Role", sql.NVarChar, selectedCouncil.Role || "User")
      .query(`
        UPDATE Users
        SET NHC_Code = @NHC_Code,
            PositionId = @PositionId,
            Role = @Role
        WHERE CNIC = @CNIC
      `);

    return res.status(200).json({
      success: true,
      message: "Primary council changed successfully",
      nhcId: parsedNhcId,
      nhcCode: `nhc-${parsedNhcId}`,
      councilName: selectedCouncil.NHCName,
      positionId: selectedCouncil.PositionId,
      role: selectedCouncil.Role || "User",
    });
  } catch (err) {
    console.error("changePrimaryCouncil error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
};