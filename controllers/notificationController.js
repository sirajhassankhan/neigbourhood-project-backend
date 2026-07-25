const { sql, getPool } = require("../db");

exports.sendNotification = async (req, res) => {
  const pool = await getPool();
  const { recipientCnic, message } = req.body;

  await pool.request()
    .input("RecipientCNIC", sql.NVarChar, recipientCnic)
    .input("Message", sql.NVarChar(sql.MAX), message)
    .query(`
      INSERT INTO Notifications (RecipientCNIC, Message)
      VALUES (@RecipientCNIC, @Message)
    `);

  res.json({ message: "Notification Sent" });
};

exports.getNotifications = async (req, res) => {
  const pool = await getPool();
  const result = await pool.request()
    .input("CNIC", sql.NVarChar, req.query.cnic)
    .query("SELECT * FROM Notifications WHERE RecipientCNIC=@CNIC order by id desc");

  res.json(result.recordset);
};
exports.sendCouncilNotification = async (req, res) => {
  try {
    const pool = await getPool();
    const { nhcId, message } = req.body;

    console.log("Received nhcId:", nhcId);
    console.log("Received message:", message);

    const nhcCode = `nhc-${nhcId}`;

    console.log("Searching for:", nhcCode);

    const users = await pool.request()
      .input("NHC_Code", sql.NVarChar, nhcCode)
      .query(`
        SELECT CNIC FROM Users 
        WHERE LOWER(NHC_Code) = LOWER(@NHC_Code)
      `);

    console.log("Users found:", users.recordset);

    if (users.recordset.length === 0) {
      return res.status(400).json({
        error: "No users found for this council"
      });
    }

    for (const user of users.recordset) {
      console.log("Inserting for:", user.CNIC);

      await pool.request()
        .input("RecipientCNIC", sql.NVarChar, user.CNIC)
        .input("Message", sql.NVarChar(sql.MAX), message)
        .query(`
          INSERT INTO Notifications (RecipientCNIC, Message)
          VALUES (@RecipientCNIC, @Message)
        `);
    }

    res.json({ message: "Council Notification Sent" });

  } catch (err) {
    console.error("Notification Error:", err);
    res.status(500).json({ error: "Server Error", detail: err.message });
  }
};