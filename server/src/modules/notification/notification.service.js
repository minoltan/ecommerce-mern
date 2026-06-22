import Notification from './notification.model.js';

const create = async ({ userId, type, template, payload }) => {
  const notification = await Notification.create({ userId, type, template, payload });

  // Replace with real email/SMS provider (e.g., SendGrid, Twilio)
  console.log(`[Notification] Sending ${type} to user ${userId} — template: ${template}`, payload);

  notification.status = 'SENT';
  notification.sentAt = new Date();
  await notification.save();

  return notification;
};

const getByUser = async (userId) => {
  return Notification.find({ userId }).sort({ createdAt: -1 }).lean();
};

export { create, getByUser };
