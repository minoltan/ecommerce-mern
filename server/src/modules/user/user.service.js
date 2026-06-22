import jwt from 'jsonwebtoken';
import User from './user.model.js';
import env from '../../shared/config/env.js';
import eventBus from '../../shared/events/eventBus.js';
import EVENTS from '../../shared/events/events.js';
import AppError from '../../shared/utils/AppError.js';

const register = async ({ name, email, password }) => {
  const exists = await User.findOne({ email });
  if (exists) throw new AppError('Email already registered', 409);

  const user = await User.create({ name, email, password });

  eventBus.publish(EVENTS.USER_REGISTERED, {
    userId: user._id.toString(),
    email: user.email,
    name: user.name,
  });

  return { id: user._id, name: user.name, email: user.email };
};

const login = async ({ email, password }) => {
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw new AppError('Invalid credentials', 401);
  }

  const token = jwt.sign(
    { sub: user._id.toString(), email: user.email, role: user.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );

  eventBus.publish(EVENTS.USER_LOGGED_IN, { userId: user._id.toString() });

  return {
    token,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  };
};

const getProfile = async (userId) => {
  const user = await User.findById(userId).lean();
  if (!user) throw new AppError('User not found', 404);
  return user;
};

export { register, login, getProfile };
