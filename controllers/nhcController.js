const { sql, getPool } = require("../db");

exports.getZones = async (req, res) => {
  const pool = await getPool();
  const result = await pool.request().query("SELECT * FROM NHC_Zones");
  res.json(result.recordset);
};

exports.createZone = async (req, res) => {
  try {
    const { name, points } = req.body;

    if (!name || !points || points.length < 3) {
      return res.status(400).json({ error: "Invalid data" });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input("Name", sql.NVarChar, name)
      .input("ZoneData", sql.NVarChar(sql.MAX), JSON.stringify(points))
      .query(`
        INSERT INTO NHC_Zones (Name, ZoneData)
        VALUES (@Name, @ZoneData);
        SELECT SCOPE_IDENTITY() as id
      `);

    res.json({
      message: "NHC Created Successfully",
      id: result.recordset[0].id
    });

  } catch (err) {
    console.error("Create NHC Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};
exports.checkLocation = async (req, res) => {
  try {
    const pool = await getPool();
    const { latitude, longitude } = req.body;

    const userPoint = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
    };

    const zones = await pool.request()
      .query("SELECT Id, Name, ZoneData FROM NHC_Zones");

    // Point in polygon function
    function isPointInPolygon(point, polygon) {
      let inside = false;

      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].latitude;
        const yi = polygon[i].longitude;
        const xj = polygon[j].latitude;
        const yj = polygon[j].longitude;

        const intersect =
          yi > point.longitude !== yj > point.longitude &&
          point.latitude <
            ((xj - xi) * (point.longitude - yi)) / (yj - yi) + xi;

        if (intersect) inside = !inside;
      }

      return inside;
    }

    for (const zone of zones.recordset) {
      const polygon = JSON.parse(zone.ZoneData);

      if (isPointInPolygon(userPoint, polygon)) {
        return res.json({
          nhcId: zone.Id,
          nhcName: zone.Name,
        });
      }
    }

    // No council found
    res.json({
      nhcId: null,
      nhcName: null,
    });

  } catch (err) {
    console.error("Check Location Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};
exports.getNHCCount = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query("SELECT COUNT(*) AS total FROM NHC_Zones");

    res.json({ total: result.recordset[0].total });

  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
};