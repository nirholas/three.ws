export default (req, res) => {
  const { id } = req.query;
  const newId = Math.random().toString(36).substring(2, 15);
  res.status(200).json({
    data: {
      agent: {
        id: newId,
      }
    }
  });
}
