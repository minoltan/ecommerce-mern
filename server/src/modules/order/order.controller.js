const orderService = require('./order.service');

const list = async (req, res, next) => {
  try {
    const result = await orderService.getByUser(req.user.sub, req.query);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

const getOne = async (req, res, next) => {
  try {
    const order = await orderService.getById(req.params.id, req.user.sub);
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

const cancel = async (req, res, next) => {
  try {
    const order = await orderService.cancel(req.params.id, req.user.sub);
    res.json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
};

module.exports = { list, getOne, cancel };
