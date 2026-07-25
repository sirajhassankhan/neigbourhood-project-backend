const { sql, getPool } = require("../db");

exports.getPositions = async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query("SELECT * FROM Positions");
  res.json(result.recordset);
};

exports.createPosition = async (req, res) => {
  const pool = await getPool();
  const { name } = req.body;

  await pool.request()
    .input("Name", sql.NVarChar, name)
    .query("INSERT INTO Positions (Name) VALUES (@Name)");

  res.json({ message: "Position Created" });
};
