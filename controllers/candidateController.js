const { sql, getPool } = require("../db");

exports.getCandidates = async (req, res) => {
  const pool = await getPool();
  const result = await pool.request()
    .input("NHC_Id", sql.Int, req.query.nhcId)
    .query("SELECT * FROM Candidates WHERE NHC_Id=@NHC_Id");

  res.json(result.recordset);
};

exports.nominateSelf = async (req, res) => {
  const pool = await getPool();
  const { cnic, nhcId, category } = req.body;

  await pool.request()
    .input("CNIC", sql.NVarChar, cnic)
    .input("NHC_Id", sql.Int, nhcId)
    .input("Category", sql.NVarChar, category)
    .query(`
      INSERT INTO Candidates (CNIC, NHC_Id, Category)
      VALUES (@CNIC, @NHC_Id, @Category)
    `);

  res.json({ message: "Nomination Submitted" });
};

exports.supportCandidate = async (req, res) => {
  const pool = await getPool();
  const { supporterCnic } = req.body;

  await pool.request()
    .input("CandidateId", sql.Int, req.params.id)
    .input("SupporterCNIC", sql.NVarChar, supporterCnic)
    .query(`
      INSERT INTO CandidateSupports (CandidateId, SupporterCNIC)
      VALUES (@CandidateId, @SupporterCNIC)
    `);

  res.json({ message: "Support Added" });
};
