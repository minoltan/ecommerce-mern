const paymentService = require('./payment.service');

const refund = async (req, res, next) => {
  try {
    const payment = await paymentService.refund(req.params.id, req.user.sub);
    res.json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
};

module.exports = { refund };
