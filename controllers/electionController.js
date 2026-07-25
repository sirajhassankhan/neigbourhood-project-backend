const { sql, getPool } = require("../db");

// ================= GET ALL ELECTIONS =================
exports.getElections = async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT 
        E.Id,
        E.NHC_Id,
        Z.Name,
        E.ElectionStartDate,
        E.ElectionEndDate
      FROM Elections E
      JOIN NHC_Zones Z ON E.NHC_Id = Z.Id
      ORDER BY E.Id DESC
    `);

    return res.status(200).json(result.recordset);
  } catch (err) {
    console.error("Get Elections Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= CREATE ELECTION =================
exports.createElection = async (req, res) => {
  try {
    const pool = await getPool();
    const { nhcId, startDate, endDate } = req.body;

    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId) || !startDate || !endDate) {
      return res.status(400).json({ error: "Missing Fields" });
    }

    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({
        error: "Election start date cannot be after end date",
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
      return res.status(404).json({ error: "NHC not found" });
    }

    const overlapCheck = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .input("StartDate", sql.Date, startDate)
      .input("EndDate", sql.Date, endDate)
      .query(`
        SELECT TOP 1 Id
        FROM Elections
        WHERE NHC_Id = @NHC_Id
          AND (
            (@StartDate BETWEEN ElectionStartDate AND ElectionEndDate)
            OR
            (@EndDate BETWEEN ElectionStartDate AND ElectionEndDate)
            OR
            (ElectionStartDate BETWEEN @StartDate AND @EndDate)
          )
      `);

    if (overlapCheck.recordset.length > 0) {
      return res.status(400).json({
        error: "Election period overlaps existing election schedule",
      });
    }

    await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .input("ElectionStartDate", sql.Date, startDate)
      .input("ElectionEndDate", sql.Date, endDate)
      .query(`
        INSERT INTO Elections
        (
          NHC_Id,
          ElectionStartDate,
          ElectionEndDate
        )
        VALUES
        (
          @NHC_Id,
          @ElectionStartDate,
          @ElectionEndDate
        )
      `);

    return res.status(201).json({
      message: "Election Created Successfully",
    });
  } catch (err) {
    console.error("Create Election Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= GET ACTIVE ELECTION =================
exports.getActiveElection = async (req, res) => {
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
          ElectionStartDate,
          ElectionEndDate
        FROM Elections
        WHERE NHC_Id = @NHC_Id
          AND CAST(GETDATE() AS DATE)
              BETWEEN CAST(ElectionStartDate AS DATE)
              AND CAST(ElectionEndDate AS DATE)
        ORDER BY Id DESC
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: "No active election found",
      });
    }

    return res.status(200).json({
      electionId: result.recordset[0].Id,
      nhcId: result.recordset[0].NHC_Id,
      electionStartDate: result.recordset[0].ElectionStartDate,
      electionEndDate: result.recordset[0].ElectionEndDate,
    });
  } catch (err) {
    console.error("Get Active Election Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= GET ELECTION PANELS =================
exports.getElectionPanels = async (req, res) => {
  try {
    const { electionId } = req.params;
    const { cnic, nhcId } = req.query;

    const parsedElectionId = parseInt(electionId, 10);
    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedElectionId) || isNaN(parsedNhcId) || !cnic) {
      return res.status(400).json({
        error: "electionId, nhcId and cnic are required",
      });
    }

    const pool = await getPool();

    // 1. Check election exists and belongs to NHC
    const electionQuery = await pool
      .request()
      .input("ElectionId", sql.Int, parsedElectionId)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1
          Id,
          NHC_Id,
          ElectionStartDate,
          ElectionEndDate
        FROM Elections
        WHERE Id = @ElectionId
          AND NHC_Id = @NHC_Id
      `);

    if (electionQuery.recordset.length === 0) {
      return res.status(404).json({ error: "Election not found" });
    }

    const election = electionQuery.recordset[0];

    // 2. Check voter belongs to this council using UserNHCs
    const membershipCheck = await pool
      .request()
      .input("VoterCNIC", sql.VarChar, cnic)
      .input("NHC_Id", sql.Int, election.NHC_Id)
      .query(`
        SELECT TOP 1 Id
        FROM UserNHCs
        WHERE UserCNIC = @VoterCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    if (membershipCheck.recordset.length === 0) {
      return res.status(403).json({
        error: "You are not a member of this council",
      });
    }

    // 3. Check if already voted
    const voteCheck = await pool
      .request()
      .input("ElectionId", sql.Int, parsedElectionId)
      .input("VoterCNIC", sql.VarChar, cnic)
      .query(`
        SELECT TOP 1 CandidateId
        FROM ElectionVotes
        WHERE ElectionId = @ElectionId
          AND VoterCNIC = @VoterCNIC
      `);

    const alreadyVoted = voteCheck.recordset.length > 0;
    const votedCandidateId = alreadyVoted
      ? voteCheck.recordset[0].CandidateId
      : null;

    // 4. Find latest nomination before election start
    const nominationQuery = await pool
      .request()
      .input("NHC_Id", sql.Int, election.NHC_Id)
      .input("ElectionStartDate", sql.DateTime, election.ElectionStartDate)
      .query(`
        SELECT TOP 1 Id
        FROM Nominations
        WHERE NHC_Id = @NHC_Id
          AND NominationEndDate <= @ElectionStartDate
        ORDER BY Id DESC
      `);

    if (nominationQuery.recordset.length === 0) {
      return res.status(200).json({
        alreadyVoted,
        votedCandidateId,
        panels: [],
      });
    }

    const nominationId = nominationQuery.recordset[0].Id;

    // 5. Return only eligible approved candidates from that nomination
    const result = await pool
      .request()
      .input("NHC_Id", sql.Int, election.NHC_Id)
      .input("NominationId", sql.Int, nominationId)
      .query(`
        SELECT
          c.Id,
          c.CNIC,
          c.NHC_Id,
          c.NominationId,
          c.PanelId,
          c.Status,
          c.IsEligible,
          c.TotalVotes AS NominationVotes,
          p.PanelName,

          presidentUser.FirstName + ' ' + presidentUser.LastName AS PresidentName,
          presidentUser.ProfileImage AS PresidentImage,

          treasurerUser.FirstName + ' ' + treasurerUser.LastName AS TreasurerName,
          treasurerUser.ProfileImage AS TreasurerImage,

          viceUser.FirstName + ' ' + viceUser.LastName AS VicePresidentName,
          viceUser.ProfileImage AS VicePresidentImage

        FROM Candidates c
        INNER JOIN Panels p
          ON c.PanelId = p.Id

        LEFT JOIN Users presidentUser
          ON p.PresidentCNIC = presidentUser.CNIC

        LEFT JOIN PanelMembers treasurerPm
          ON p.Id = treasurerPm.PanelId
         AND treasurerPm.Role = 'Treasurer'
         AND LOWER(treasurerPm.InviteStatus) = 'accepted'
         AND LOWER(ISNULL(treasurerPm.MemberStatus, 'active')) = 'active'

        LEFT JOIN Users treasurerUser
          ON treasurerPm.CNIC = treasurerUser.CNIC

        LEFT JOIN PanelMembers vicePm
          ON p.Id = vicePm.PanelId
         AND vicePm.Role = 'Vice President'
         AND LOWER(vicePm.InviteStatus) = 'accepted'
         AND LOWER(ISNULL(vicePm.MemberStatus, 'active')) = 'active'

        LEFT JOIN Users viceUser
          ON vicePm.CNIC = viceUser.CNIC

        WHERE c.NHC_Id = @NHC_Id
          AND c.NominationId = @NominationId
          AND c.IsEligible = 1
          AND c.Status = 'Approved'
          AND LOWER(p.Status) = 'approved'
        ORDER BY c.Id DESC
      `);

    return res.status(200).json({
      alreadyVoted,
      votedCandidateId,
      panels: result.recordset,
    });
  } catch (err) {
    console.error("Get Election Panels Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= CAST PANEL VOTE =================
exports.castVote = async (req, res) => {
  let transaction;

  try {
    const pool = await getPool();
    const { electionId, voterCnic, candidateId, nhcId } = req.body;

    const parsedElectionId = parseInt(electionId, 10);
    const parsedCandidateId = parseInt(candidateId, 10);
    const parsedNhcId = parseInt(nhcId, 10);

    if (
      isNaN(parsedElectionId) ||
      !voterCnic ||
      isNaN(parsedCandidateId) ||
      isNaN(parsedNhcId)
    ) {
      return res.status(400).json({ error: "Missing Fields" });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    // 1. Check active election
    const electionResult = await new sql.Request(transaction)
      .input("ElectionId", sql.Int, parsedElectionId)
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT
          Id,
          NHC_Id,
          ElectionStartDate,
          ElectionEndDate
        FROM Elections
        WHERE Id = @ElectionId
          AND NHC_Id = @NHC_Id
          AND CAST(GETDATE() AS DATE)
              BETWEEN CAST(ElectionStartDate AS DATE)
              AND CAST(ElectionEndDate AS DATE)
      `);

    if (electionResult.recordset.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: "Election is not active for this council",
      });
    }

    const election = electionResult.recordset[0];

    // 2. Check voter belongs to this council
    const voterMembership = await new sql.Request(transaction)
      .input("VoterCNIC", sql.VarChar, voterCnic)
      .input("NHC_Id", sql.Int, election.NHC_Id)
      .query(`
        SELECT TOP 1 Id
        FROM UserNHCs
        WHERE UserCNIC = @VoterCNIC
          AND NHC_Id = @NHC_Id
          AND IsActive = 1
      `);

    if (voterMembership.recordset.length === 0) {
      await transaction.rollback();
      return res.status(403).json({
        error: "You are not a member of this council",
      });
    }

    // 3. Find ended nomination linked to election
    const nominationQuery = await new sql.Request(transaction)
      .input("NHC_Id", sql.Int, election.NHC_Id)
      .input("ElectionStartDate", sql.DateTime, election.ElectionStartDate)
      .query(`
        SELECT TOP 1 Id
        FROM Nominations
        WHERE NHC_Id = @NHC_Id
          AND ISNULL(IsEnded, 0) = 1
          AND NominationEndDate <= @ElectionStartDate
        ORDER BY Id DESC
      `);

    if (nominationQuery.recordset.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: "No ended nomination cycle found for this election",
      });
    }

    const nominationId = nominationQuery.recordset[0].Id;

    // 4. Check candidate is eligible
    const candidateCheck = await new sql.Request(transaction)
      .input("CandidateId", sql.Int, parsedCandidateId)
      .input("NHC_Id", sql.Int, election.NHC_Id)
      .input("NominationId", sql.Int, nominationId)
      .query(`
        SELECT TOP 1
          c.Id,
          c.CNIC,
          c.NHC_Id,
          c.NominationId,
          c.PanelId,
          c.IsEligible,
          c.Status,
          p.Status AS PanelStatus
        FROM Candidates c
        INNER JOIN Panels p
          ON c.PanelId = p.Id
        WHERE c.Id = @CandidateId
          AND c.NHC_Id = @NHC_Id
          AND c.NominationId = @NominationId
          AND c.IsEligible = 1
          AND c.Status = 'Approved'
          AND LOWER(p.Status) = 'approved'
      `);

    if (candidateCheck.recordset.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: "Selected panel is not eligible for election",
      });
    }

    const candidate = candidateCheck.recordset[0];

    // 5. Panel member cannot vote for own panel
    const ownPanelVoteCheck = await new sql.Request(transaction)
      .input("PanelId", sql.Int, candidate.PanelId)
      .input("VoterCNIC", sql.VarChar, voterCnic)
      .query(`
        SELECT TOP 1 Id
        FROM PanelMembers
        WHERE PanelId = @PanelId
          AND CNIC = @VoterCNIC
          AND LOWER(InviteStatus) = 'accepted'
          AND LOWER(ISNULL(MemberStatus, 'active')) = 'active'
      `);

    if (ownPanelVoteCheck.recordset.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: "You cannot vote for your own panel",
      });
    }

    // 6. Prevent duplicate vote in same election
    const existingVote = await new sql.Request(transaction)
      .input("ElectionId", sql.Int, parsedElectionId)
      .input("VoterCNIC", sql.VarChar, voterCnic)
      .query(`
        SELECT TOP 1 Id
        FROM ElectionVotes
        WHERE ElectionId = @ElectionId
          AND VoterCNIC = @VoterCNIC
      `);

    if (existingVote.recordset.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: "You have already voted",
      });
    }

    // 7. Insert vote
    await new sql.Request(transaction)
      .input("ElectionId", sql.Int, parsedElectionId)
      .input("NHC_Id", sql.Int, election.NHC_Id)
      .input("VoterCNIC", sql.VarChar, voterCnic)
      .input("CandidateId", sql.Int, parsedCandidateId)
      .input("ElectionEndDate", sql.Date, election.ElectionEndDate)
      .query(`
        INSERT INTO ElectionVotes
        (
          ElectionId,
          NHC_Id,
          VoterCNIC,
          CandidateId,
          ElectionEndDate
        )
        VALUES
        (
          @ElectionId,
          @NHC_Id,
          @VoterCNIC,
          @CandidateId,
          @ElectionEndDate
        )
      `);

    await transaction.commit();

    return res.status(200).json({
      message: "Vote Cast Successfully",
      candidateId: parsedCandidateId,
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("Vote Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= GET RESULTS BY ELECTION ID =================
exports.getResults = async (req, res) => {
  try {
    const pool = await getPool();
    const { electionId } = req.params;
    const parsedElectionId = parseInt(electionId, 10);

    if (isNaN(parsedElectionId)) {
      return res.status(400).json({ error: "Invalid election id" });
    }

    const savedResults = await pool
      .request()
      .input("ElectionId", sql.Int, parsedElectionId)
      .query(`
        SELECT 
          er.ElectionId,
          ISNULL(er.PanelId, c.PanelId) AS PanelId,
          er.CandidateId,
          er.TotalVotes,
          er.CreatedDate,
          p.PanelName,

          presidentUser.FirstName + ' ' + presidentUser.LastName AS PresidentName,
          presidentUser.ProfileImage AS PresidentImage,

          treasurerUser.FirstName + ' ' + treasurerUser.LastName AS TreasurerName,
          treasurerUser.ProfileImage AS TreasurerImage,

          viceUser.FirstName + ' ' + viceUser.LastName AS VicePresidentName,
          viceUser.ProfileImage AS VicePresidentImage

        FROM ElectionResults er
        LEFT JOIN Candidates c
          ON er.CandidateId = c.Id

        INNER JOIN Panels p
          ON ISNULL(er.PanelId, c.PanelId) = p.Id

        LEFT JOIN Users presidentUser
          ON p.PresidentCNIC = presidentUser.CNIC

        LEFT JOIN PanelMembers treasurerPm
          ON p.Id = treasurerPm.PanelId
         AND treasurerPm.Role = 'Treasurer'
         AND LOWER(treasurerPm.InviteStatus) = 'accepted'
         AND LOWER(ISNULL(treasurerPm.MemberStatus, 'active')) = 'active'

        LEFT JOIN Users treasurerUser
          ON treasurerPm.CNIC = treasurerUser.CNIC

        LEFT JOIN PanelMembers vicePm
          ON p.Id = vicePm.PanelId
         AND vicePm.Role = 'Vice President'
         AND LOWER(vicePm.InviteStatus) = 'accepted'
         AND LOWER(ISNULL(vicePm.MemberStatus, 'active')) = 'active'

        LEFT JOIN Users viceUser
          ON vicePm.CNIC = viceUser.CNIC

        WHERE er.ElectionId = @ElectionId
        ORDER BY er.TotalVotes DESC, er.CandidateId ASC
      `);

    if (savedResults.recordset.length > 0) {
      return res.status(200).json(savedResults.recordset);
    }

    const result = await pool
      .request()
      .input("ElectionId", sql.Int, parsedElectionId)
      .query(`
        SELECT 
          c.Id AS CandidateId,
          c.PanelId,
          p.PanelName,

          presidentUser.FirstName + ' ' + presidentUser.LastName AS PresidentName,
          presidentUser.ProfileImage AS PresidentImage,

          treasurerUser.FirstName + ' ' + treasurerUser.LastName AS TreasurerName,
          treasurerUser.ProfileImage AS TreasurerImage,

          viceUser.FirstName + ' ' + viceUser.LastName AS VicePresidentName,
          viceUser.ProfileImage AS VicePresidentImage,

          COUNT(ev.Id) AS TotalVotes

        FROM ElectionVotes ev
        INNER JOIN Candidates c
          ON ev.CandidateId = c.Id

        INNER JOIN Panels p
          ON c.PanelId = p.Id

        LEFT JOIN Users presidentUser
          ON p.PresidentCNIC = presidentUser.CNIC

        LEFT JOIN PanelMembers treasurerPm
          ON p.Id = treasurerPm.PanelId
         AND treasurerPm.Role = 'Treasurer'
         AND LOWER(treasurerPm.InviteStatus) = 'accepted'
         AND LOWER(ISNULL(treasurerPm.MemberStatus, 'active')) = 'active'

        LEFT JOIN Users treasurerUser
          ON treasurerPm.CNIC = treasurerUser.CNIC

        LEFT JOIN PanelMembers vicePm
          ON p.Id = vicePm.PanelId
         AND vicePm.Role = 'Vice President'
         AND LOWER(vicePm.InviteStatus) = 'accepted'
         AND LOWER(ISNULL(vicePm.MemberStatus, 'active')) = 'active'

        LEFT JOIN Users viceUser
          ON vicePm.CNIC = viceUser.CNIC

        WHERE ev.ElectionId = @ElectionId

        GROUP BY
          c.Id,
          c.PanelId,
          p.PanelName,
          presidentUser.FirstName,
          presidentUser.LastName,
          presidentUser.ProfileImage,
          treasurerUser.FirstName,
          treasurerUser.LastName,
          treasurerUser.ProfileImage,
          viceUser.FirstName,
          viceUser.LastName,
          viceUser.ProfileImage

        ORDER BY TotalVotes DESC, c.Id ASC
      `);

    return res.status(200).json(result.recordset);
  } catch (err) {
    console.error("Results Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= END ELECTION =================
exports.endElection = async (req, res) => {
  let transaction;

  try {
    const pool = await getPool();
    const { id } = req.params;
    const electionId = parseInt(id, 10);

    if (isNaN(electionId)) {
      return res.status(400).json({ error: "Invalid election id" });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const electionQuery = await new sql.Request(transaction)
      .input("Id", sql.Int, electionId)
      .query(`
        SELECT
          Id,
          NHC_Id,
          ElectionStartDate,
          ElectionEndDate
        FROM Elections
        WHERE Id = @Id
      `);

    if (electionQuery.recordset.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "Election not found" });
    }

    const election = electionQuery.recordset[0];

    const nominationQuery = await new sql.Request(transaction)
      .input("NHC_Id", sql.Int, election.NHC_Id)
      .input("ElectionStartDate", sql.DateTime, election.ElectionStartDate)
      .query(`
        SELECT TOP 1 Id
        FROM Nominations
        WHERE NHC_Id = @NHC_Id
          AND NominationEndDate <= @ElectionStartDate
        ORDER BY Id DESC
      `);

    if (nominationQuery.recordset.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: "No nomination cycle found for this election",
      });
    }

    const nominationId = nominationQuery.recordset[0].Id;

    await new sql.Request(transaction)
      .input("Id", sql.Int, electionId)
      .query(`
        UPDATE Elections
        SET ElectionEndDate = GETDATE()
        WHERE Id = @Id
      `);

    await new sql.Request(transaction)
      .input("ElectionId", sql.Int, electionId)
      .query(`
        DELETE FROM ElectionResults
        WHERE ElectionId = @ElectionId
      `);

    const resultsQuery = await new sql.Request(transaction)
      .input("ElectionId", sql.Int, electionId)
      .input("NominationId", sql.Int, nominationId)
      .input("NHC_Id", sql.Int, election.NHC_Id)
      .query(`
        SELECT 
          c.Id AS CandidateId,
          c.PanelId,
          c.NHC_Id,
          COUNT(ev.Id) AS TotalVotes
        FROM Candidates c
        LEFT JOIN ElectionVotes ev
          ON ev.CandidateId = c.Id
         AND ev.ElectionId = @ElectionId
        INNER JOIN Panels p
          ON c.PanelId = p.Id
        WHERE c.NominationId = @NominationId
          AND c.NHC_Id = @NHC_Id
          AND c.IsEligible = 1
          AND c.Status = 'Approved'
          AND LOWER(p.Status) = 'approved'
        GROUP BY
          c.Id,
          c.PanelId,
          c.NHC_Id
        ORDER BY TotalVotes DESC, c.Id ASC
      `);

    const results = resultsQuery.recordset;

    if (results.length === 0) {
      await transaction.commit();

      return res.status(200).json({
        message:
          "Election ended, but no approved panels were found for this election cycle",
        winner: null,
      });
    }

    for (const row of results) {
      await new sql.Request(transaction)
        .input("ElectionId", sql.Int, electionId)
        .input("ResultNHC_Id", sql.Int, row.NHC_Id)
        .input("PanelId", sql.Int, row.PanelId)
        .input("CandidateId", sql.Int, row.CandidateId)
        .input("TotalVotes", sql.Int, row.TotalVotes)
        .query(`
          INSERT INTO ElectionResults
          (
            ElectionId,
            NHC_Id,
            PanelId,
            CandidateId,
            TotalVotes,
            CreatedDate
          )
          VALUES
          (
            @ElectionId,
            @ResultNHC_Id,
            @PanelId,
            @CandidateId,
            @TotalVotes,
            GETDATE()
          )
        `);
    }

    const winner = results[0];

    // Only assign positions if winner has at least 1 vote
    if (winner.TotalVotes >= 1) {
      // Clear previous positions only in this council
      await new sql.Request(transaction)
        .input("NHC_Id", sql.Int, election.NHC_Id)
        .query(`
          UPDATE UserNHCs
          SET PositionId = NULL
          WHERE NHC_Id = @NHC_Id
            AND PositionId IN (1, 2, 3)
        `);

      const panelQuery = await new sql.Request(transaction)
        .input("PanelId", sql.Int, winner.PanelId)
        .query(`
          SELECT PresidentCNIC
          FROM Panels
          WHERE Id = @PanelId
        `);

      if (panelQuery.recordset.length > 0) {
        const presidentCnic = panelQuery.recordset[0].PresidentCNIC;

        await new sql.Request(transaction)
          .input("CNIC", sql.VarChar, presidentCnic)
          .input("NHC_Id", sql.Int, election.NHC_Id)
          .query(`
            UPDATE UserNHCs
            SET PositionId = 1,
                Role = 'President'
            WHERE UserCNIC = @CNIC
              AND NHC_Id = @NHC_Id
              AND IsActive = 1
          `);
      }

      const membersQuery = await new sql.Request(transaction)
        .input("PanelId", sql.Int, winner.PanelId)
        .query(`
          SELECT CNIC, Role
          FROM PanelMembers
          WHERE PanelId = @PanelId
            AND LOWER(InviteStatus) = 'accepted'
            AND LOWER(ISNULL(MemberStatus, 'active')) = 'active'
        `);

      for (const member of membersQuery.recordset) {
        if (member.Role === "Treasurer") {
          await new sql.Request(transaction)
            .input("CNIC", sql.VarChar, member.CNIC)
            .input("NHC_Id", sql.Int, election.NHC_Id)
            .query(`
              UPDATE UserNHCs
              SET PositionId = 2,
                  Role = 'Treasurer'
              WHERE UserCNIC = @CNIC
                AND NHC_Id = @NHC_Id
                AND IsActive = 1
            `);
        }

        if (member.Role === "Vice President") {
          await new sql.Request(transaction)
            .input("CNIC", sql.VarChar, member.CNIC)
            .input("NHC_Id", sql.Int, election.NHC_Id)
            .query(`
              UPDATE UserNHCs
              SET PositionId = 3,
                  Role = 'Vice President'
              WHERE UserCNIC = @CNIC
                AND NHC_Id = @NHC_Id
                AND IsActive = 1
            `);
        }
      }
    }

    await transaction.commit();

    return res.status(200).json({
      message: "Election ended successfully and results generated",
      winner,
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (_) {}
    }

    console.error("End Election Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= DELETE ELECTION =================
exports.deleteElection = async (req, res) => {
  try {
    const pool = await getPool();
    const { id } = req.params;
    const electionId = parseInt(id, 10);

    if (isNaN(electionId)) {
      return res.status(400).json({ error: "Invalid election id" });
    }

    await pool
      .request()
      .input("Id", sql.Int, electionId)
      .query(`
        DELETE FROM Elections
        WHERE Id = @Id
      `);

    return res.status(200).json({
      message: "Election Deleted Successfully",
    });
  } catch (err) {
    console.error("Delete Election Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= GET LATEST ENDED ELECTION RESULTS BY NHC =================
exports.getEndedElectionResultsByNhc = async (req, res) => {
  try {
    const { nhcId } = req.params;
    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({ error: "Invalid NHC id" });
    }

    const pool = await getPool();

    const electionResult = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT TOP 1
          e.Id,
          e.ElectionStartDate,
          e.ElectionEndDate
        FROM Elections e
        WHERE e.NHC_Id = @NHC_Id
          AND EXISTS (
            SELECT 1
            FROM ElectionResults er
            WHERE er.ElectionId = e.Id
          )
        ORDER BY e.Id DESC
      `);

    if (electionResult.recordset.length === 0) {
      return res.status(404).json({
        message: "No election result found for this NHC",
      });
    }

    const election = electionResult.recordset[0];
    const electionId = election.Id;

    const results = await pool
      .request()
      .input("ElectionId", sql.Int, electionId)
      .query(`
        SELECT 
          er.ElectionId,
          ISNULL(er.PanelId, c.PanelId) AS PanelId,
          er.CandidateId,
          er.TotalVotes,
          er.CreatedDate,
          p.PanelName,

          presidentUser.FirstName + ' ' + presidentUser.LastName AS PresidentName,
          presidentUser.ProfileImage AS PresidentImage,

          treasurerUser.FirstName + ' ' + treasurerUser.LastName AS TreasurerName,
          treasurerUser.ProfileImage AS TreasurerImage,

          viceUser.FirstName + ' ' + viceUser.LastName AS VicePresidentName,
          viceUser.ProfileImage AS VicePresidentImage

        FROM ElectionResults er

        LEFT JOIN Candidates c
          ON er.CandidateId = c.Id

        INNER JOIN Panels p
          ON ISNULL(er.PanelId, c.PanelId) = p.Id

        LEFT JOIN Users presidentUser
          ON p.PresidentCNIC = presidentUser.CNIC

        LEFT JOIN PanelMembers treasurerPm
          ON p.Id = treasurerPm.PanelId
         AND treasurerPm.Role = 'Treasurer'
         AND LOWER(treasurerPm.InviteStatus) = 'accepted'
         AND LOWER(ISNULL(treasurerPm.MemberStatus, 'active')) = 'active'

        LEFT JOIN Users treasurerUser
          ON treasurerPm.CNIC = treasurerUser.CNIC

        LEFT JOIN PanelMembers vicePm
          ON p.Id = vicePm.PanelId
         AND vicePm.Role = 'Vice President'
         AND LOWER(vicePm.InviteStatus) = 'accepted'
         AND LOWER(ISNULL(vicePm.MemberStatus, 'active')) = 'active'

        LEFT JOIN Users viceUser
          ON vicePm.CNIC = viceUser.CNIC

        WHERE er.ElectionId = @ElectionId
        ORDER BY er.TotalVotes DESC, er.CandidateId ASC
      `);

    return res.status(200).json({
      electionId,
      electionStartDate: election.ElectionStartDate,
      electionEndDate: election.ElectionEndDate,
      winner: results.recordset.length > 0 ? results.recordset[0] : null,
      results: results.recordset,
    });
  } catch (err) {
    console.error("getEndedElectionResultsByNhc Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= ADMIN: GET COUNCILS WITH RESULTS =================
exports.getCouncilsWithElectionResults = async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT DISTINCT
        z.Id,
        z.Name
      FROM NHC_Zones z
      INNER JOIN Elections e
        ON z.Id = e.NHC_Id
      INNER JOIN ElectionResults er
        ON e.Id = er.ElectionId
      ORDER BY z.Name ASC
    `);

    return res.status(200).json(result.recordset);
  } catch (err) {
    console.error("getCouncilsWithElectionResults Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= ADMIN: GET COUNCIL ELECTION HISTORY =================
exports.getCouncilElectionHistory = async (req, res) => {
  try {
    const { nhcId } = req.params;
    const parsedNhcId = parseInt(nhcId, 10);

    if (isNaN(parsedNhcId)) {
      return res.status(400).json({ error: "Invalid NHC id" });
    }

    const pool = await getPool();

    const result = await pool
      .request()
      .input("NHC_Id", sql.Int, parsedNhcId)
      .query(`
        SELECT DISTINCT
          e.Id,
          e.ElectionStartDate,
          e.ElectionEndDate
        FROM Elections e
        INNER JOIN ElectionResults er
          ON e.Id = er.ElectionId
        WHERE e.NHC_Id = @NHC_Id
        ORDER BY e.Id DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (err) {
    console.error("getCouncilElectionHistory Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};

// ================= ADMIN: GET RESULT BY ELECTION ID =================
exports.getAdminElectionResultByElectionId = async (req, res) => {
  try {
    const { electionId } = req.params;
    const parsedElectionId = parseInt(electionId, 10);

    if (isNaN(parsedElectionId)) {
      return res.status(400).json({ error: "Invalid election id" });
    }

    const pool = await getPool();

    const electionQuery = await pool
      .request()
      .input("ElectionId", sql.Int, parsedElectionId)
      .query(`
        SELECT TOP 1
          e.Id,
          e.NHC_Id,
          z.Name AS CouncilName,
          e.ElectionStartDate,
          e.ElectionEndDate
        FROM Elections e
        INNER JOIN NHC_Zones z
          ON e.NHC_Id = z.Id
        WHERE e.Id = @ElectionId
      `);

    if (electionQuery.recordset.length === 0) {
      return res.status(404).json({ error: "Election not found" });
    }

    const election = electionQuery.recordset[0];

    const results = await pool
      .request()
      .input("ElectionId", sql.Int, parsedElectionId)
      .query(`
        SELECT 
          er.ElectionId,
          ISNULL(er.PanelId, c.PanelId) AS PanelId,
          er.CandidateId,
          er.TotalVotes,
          er.CreatedDate,
          p.PanelName,

          presidentUser.FirstName + ' ' + presidentUser.LastName AS PresidentName,
          presidentUser.ProfileImage AS PresidentImage,

          treasurerUser.FirstName + ' ' + treasurerUser.LastName AS TreasurerName,
          treasurerUser.ProfileImage AS TreasurerImage,

          viceUser.FirstName + ' ' + viceUser.LastName AS VicePresidentName,
          viceUser.ProfileImage AS VicePresidentImage

        FROM ElectionResults er

        LEFT JOIN Candidates c
          ON er.CandidateId = c.Id

        INNER JOIN Panels p
          ON ISNULL(er.PanelId, c.PanelId) = p.Id

        LEFT JOIN Users presidentUser
          ON p.PresidentCNIC = presidentUser.CNIC

        LEFT JOIN PanelMembers treasurerPm
          ON p.Id = treasurerPm.PanelId
         AND treasurerPm.Role = 'Treasurer'
         AND LOWER(treasurerPm.InviteStatus) = 'accepted'
         AND LOWER(ISNULL(treasurerPm.MemberStatus, 'active')) = 'active'

        LEFT JOIN Users treasurerUser
          ON treasurerPm.CNIC = treasurerUser.CNIC

        LEFT JOIN PanelMembers vicePm
          ON p.Id = vicePm.PanelId
         AND vicePm.Role = 'Vice President'
         AND LOWER(vicePm.InviteStatus) = 'accepted'
         AND LOWER(ISNULL(vicePm.MemberStatus, 'active')) = 'active'

        LEFT JOIN Users viceUser
          ON vicePm.CNIC = viceUser.CNIC

        WHERE er.ElectionId = @ElectionId
        ORDER BY er.TotalVotes DESC, er.CandidateId ASC
      `);

    return res.status(200).json({
      electionId: election.Id,
      nhcId: election.NHC_Id,
      councilName: election.CouncilName,
      electionStartDate: election.ElectionStartDate,
      electionEndDate: election.ElectionEndDate,
      winner: results.recordset.length > 0 ? results.recordset[0] : null,
      results: results.recordset,
    });
  } catch (err) {
    console.error("getAdminElectionResultByElectionId Error:", err);
    return res.status(500).json({ error: err.message || "Server Error" });
  }
};