import * as userService from './user.service.js';

const register = async (req, res, next) => {
  try {
    const user = await userService.register(req.body);
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const result = await userService.login(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await userService.getProfile(req.user.sub);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

export { register, login, getMe };
