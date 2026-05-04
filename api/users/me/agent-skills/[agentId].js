export default (req, res) => {
  // In a real application, you would fetch this from a database
  // based on the authenticated user's ID.
  const purchasedSkills = {
    "1": ["generate-poem"],
    "2": ["refactor-code"],
  };

  const { agentId } = req.query;
  const skills = purchasedSkills[agentId] || [];

  res.status(200).json({ skills });
}
