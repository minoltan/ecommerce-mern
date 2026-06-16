const inventoryService = require('./inventory.service');

const getByProduct = async (req, res, next) => {
  try {
    const inv = await inventoryService.getByProduct(req.params.productId);
    res.json({ success: true, data: inv });
  } catch (err) {
    next(err);
  }
};

const upsert = async (req, res, next) => {
  try {
    const inv = await inventoryService.upsert(req.params.productId, req.body);
    res.json({ success: true, data: inv });
  } catch (err) {
    next(err);
  }
};

module.exports = { getByProduct, upsert };
