const { sql, getPool } = require("../db");

// ================= CREATE DEVELOPMENT PROJECT =================
exports.createProject = async (req, res) => {
  try {
    const { nhcId, title, detail, estimatedBudget, createdByCnic } = req.body;

    if (!nhcId || !title || !createdByCnic) {
      return res.status(400).json({
        error: "nhcId, title and createdByCnic are required",
      });
    }

    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({
        error: "Invalid NHC id",
      });
    }

    const budgetValue =
      estimatedBudget === null ||
      estimatedBudget === undefined ||
      estimatedBudget.toString().trim() === ""
        ? null
        : parseFloat(estimatedBudget);

    if (budgetValue !== null && (isNaN(budgetValue) || budgetValue < 0)) {
      return res.status(400).json({
        error: "Invalid estimated budget",
      });
    }

    const pool = await getPool();

    const presidentCheck = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, createdByCnic)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1 Id, Role
        FROM UserNHCs
        WHERE UserCNIC = @UserCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
          AND LOWER(Role) = 'president'
      `);

    if (presidentCheck.recordset.length === 0) {
      return res.status(403).json({
        error: "Only president of this council can create development projects",
      });
    }

    const result = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .input("Title", sql.NVarChar, title.trim())
      .input(
        "Detail",
        sql.NVarChar(sql.MAX),
        detail && detail.trim() !== "" ? detail.trim() : null
      )
      .input("EstimatedBudget", sql.Decimal(18, 2), budgetValue)
      .input("CreatedByCNIC", sql.NVarChar, createdByCnic)
      .query(`
        INSERT INTO DevelopmentProjects
        (
          NHC_Id,
          Title,
          Detail,
          EstimatedBudget,
          Status,
          CreatedByCNIC,
          CreatedDate
        )
        OUTPUT INSERTED.Id
        VALUES
        (
          @NHC_Id,
          @Title,
          @Detail,
          @EstimatedBudget,
          'Planned',
          @CreatedByCNIC,
          GETDATE()
        )
      `);

    return res.status(201).json({
      message: "Development project created successfully",
      projectId: result.recordset[0].Id,
    });
  } catch (error) {
    console.error("createProject error:", error);

    return res.status(500).json({
      error: error.message || "Failed to create development project",
    });
  }
};

// ================= GET PROJECTS BY NHC =================
exports.getProjectsByNhc = async (req, res) => {
  try {
    const nhcId = parseInt(req.params.nhcId, 10);

    if (isNaN(nhcId)) {
      return res.status(400).json({
        error: "Invalid NHC id",
      });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input("NHC_Id", sql.Int, nhcId)
      .query(`
        SELECT
          p.Id AS id,
          p.NHC_Id AS nhcId,
          p.Title AS title,
          p.Detail AS detail,
          p.EstimatedBudget AS estimatedBudget,
          p.Status AS status,
          p.CreatedByCNIC AS createdByCnic,
          p.CreatedDate AS createdDate,
          p.UpdatedDate AS updatedDate,

          u.FirstName + ' ' + u.LastName AS createdByName
        FROM DevelopmentProjects p
        LEFT JOIN Users u ON p.CreatedByCNIC = u.CNIC
        WHERE p.NHC_Id = @NHC_Id
        ORDER BY p.Id DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    console.error("getProjectsByNhc error:", error);

    return res.status(500).json({
      error: error.message || "Failed to fetch development projects",
    });
  }
};

// ================= UPDATE PROJECT STATUS =================
exports.updateProjectStatus = async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    const { status, updatedByCnic } = req.body;

    if (isNaN(projectId)) {
      return res.status(400).json({
        error: "Invalid project id",
      });
    }

    if (!status || !updatedByCnic) {
      return res.status(400).json({
        error: "status and updatedByCnic are required",
      });
    }

    const allowedStatuses = ["Planned", "In Progress", "Completed", "Cancelled"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: "Invalid status",
      });
    }

    const pool = await getPool();

    const projectCheck = await pool
      .request()
      .input("ProjectId", sql.Int, projectId)
      .query(`
        SELECT TOP 1 Id, NHC_Id
        FROM DevelopmentProjects
        WHERE Id = @ProjectId
      `);

    if (projectCheck.recordset.length === 0) {
      return res.status(404).json({
        error: "Development project not found",
      });
    }

    const project = projectCheck.recordset[0];

    const presidentCheck = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, updatedByCnic)
      .input("NHC_Id", sql.Int, project.NHC_Id)
      .query(`
        SELECT TOP 1 Id, Role
        FROM UserNHCs
        WHERE UserCNIC = @UserCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
          AND LOWER(Role) = 'president'
      `);

    if (presidentCheck.recordset.length === 0) {
      return res.status(403).json({
        error: "Only president of this council can update project status",
      });
    }

    await pool
      .request()
      .input("ProjectId", sql.Int, projectId)
      .input("Status", sql.NVarChar, status)
      .query(`
        UPDATE DevelopmentProjects
        SET Status = @Status,
            UpdatedDate = GETDATE()
        WHERE Id = @ProjectId
      `);

    return res.status(200).json({
      message: "Project status updated successfully",
    });
  } catch (error) {
    console.error("updateProjectStatus error:", error);

    return res.status(500).json({
      error: error.message || "Failed to update project status",
    });
  }
};