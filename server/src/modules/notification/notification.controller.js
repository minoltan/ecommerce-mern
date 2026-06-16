const notificationService = require('./notification.service');

const list = async (req, res, next) => {
  try {
    const notifications = await notificationService.getByUser(req.user.sub);
    res.json({ success: true, data: notifications });
  } catch (err) {
    next(err);
  }
};

module.exports = { list };
