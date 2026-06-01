module.exports = function(req, res, next) {
  const modelName = req.path.match(/qwen25|qwen3\.6-17b|llama3/)[0];
  console.log(`Chamando modelo: ${modelName}`);
  next();
};