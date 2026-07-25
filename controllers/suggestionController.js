const { sql, getPool } = require("../db");

// ================= CREATE SUGGESTION =================
exports.createSuggestion = async (req, res) => {
  try {
    const { userCnic, nhcId, title, detail } = req.body;

    if (!userCnic || !nhcId || !title || !detail) {
      return res.status(400).json({
        error: "userCnic, nhcId, title and detail are required",
      });
    }

    const pool = await getPool();

    await pool
      .request()
      .input("UserCNIC", sql.NVarChar, userCnic)
      .input("NHC_Id", sql.Int, parseInt(nhcId))
      .input("Title", sql.NVarChar, title)
      .input("Detail", sql.NVarChar(sql.MAX), detail)
      .query(`
        INSERT INTO Suggestions (UserCNIC, NHC_Id, Title, Detail, CreatedDate)
        VALUES (@UserCNIC, @NHC_Id, @Title, @Detail, GETDATE())
      `);

    res.status(200).json({
      message: "Suggestion submitted successfully",
    });
  } catch (error) {
    console.error("createSuggestion error:", error);
    res.status(500).json({
      error: error.message || "Failed to submit suggestion",
    });
  }
};

// ================= GET MY SUGGESTIONS =================
exports.getMySuggestions = async (req, res) => {
  try {
    const { cnic } = req.params;
    const pool = await getPool();

    const result = await pool
      .request()
      .input("UserCNIC", sql.NVarChar, cnic)
      .query(`
        SELECT 
          Id AS id,
          UserCNIC AS userCnic,
          NHC_Id AS nhcId,
          Title AS title,
          Detail AS detail,
          CreatedDate AS createdDate
        FROM Suggestions
        WHERE UserCNIC = @UserCNIC
        ORDER BY Id DESC
      `);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("getMySuggestions error:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch suggestions",
    });
  }
};

// ================= GET SUGGESTIONS BY NHC =================
exports.getSuggestionsByNhc = async (req, res) => {
  try {
    const { nhcId } = req.params;
    const pool = await getPool();

    const result = await pool
      .request()
      .input("NHC_Id", sql.Int, parseInt(nhcId))
      .query(`
        SELECT 
          Id AS id,
          UserCNIC AS userCnic,
          NHC_Id AS nhcId,
          Title AS title,
          Detail AS detail,
          CreatedDate AS createdDate
        FROM Suggestions
        WHERE NHC_Id = @NHC_Id
        ORDER BY Id DESC
      `);

    res.status(200).json(result.recordset);
  } catch (error) {
    console.error("getSuggestionsByNhc error:", error);
    res.status(500).json({
      error: error.message || "Failed to fetch NHC suggestions",
    });
  }
};