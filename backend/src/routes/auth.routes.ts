import {
  Router,
  Request,
  Response,
  NextFunction,
} from 'express';

import {
  sendSuccess,
  sendError,
} from '../utils/response';

import {
  register,
  customerLogin,
  businessLogin,
  getMe,
  updateProfile,
  changePassword,
  verifyMobileOtp,
  sendRegistrationOtp,
  sendPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPassword,
  businessRegister,
  sendEntryOtp,
  verifyEntryOtp,
  resendEntryOtp,
  sorterLogin,
} from '../services/auth.service';

import {
  authenticate,
  AuthenticatedRequest,
} from '../middleware/auth';

import {
  handleValidation,
} from '../middleware/validate';

import {
  customerRegisterValidation,
  customerLoginValidation,
  businessLoginValidation,
  changePasswordValidation,
  mobileOtpValidation,
  resendOtpValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  businessRegisterValidation,
  entryOtpSendValidation,
  entryOtpVerifyValidation,
} from '../validators/auth.validators';

import {
  authLimiter,
} from '../middleware/rateLimiter';


const router = Router();


// ======================================================
// CUSTOMER REGISTRATION
// ======================================================

router.post(
  '/customer/register',
  authLimiter,
  customerRegisterValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const {
        name,
        email,
        mobile,
        password,
      } = req.body;


      await register(
        name,
        email,
        mobile,
        password
      );

      const result = await customerLogin(email, password);

      sendSuccess(
        res,
        result,
        'Registration successful.',
        201
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// CUSTOMER MOBILE VERIFICATION
// ======================================================

router.post(
  '/customer/verify-mobile',
  authLimiter,
  mobileOtpValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const {
        mobile,
        otp,
      } = req.body;


      const result =
        await verifyMobileOtp(
          mobile,
          otp
        );


      sendSuccess(
        res,
        result,
        'Mobile verified successfully.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// CUSTOMER RESEND REGISTRATION OTP
// ======================================================

router.post(
  '/customer/resend-otp',
  authLimiter,
  resendOtpValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const {
        mobile,
      } = req.body;


      await sendRegistrationOtp(
        mobile
      );


      sendSuccess(
        res,
        null,
        'OTP resent successfully.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// CUSTOMER LOGIN
// ======================================================

router.post(
  '/customer/login',
  authLimiter,
  customerLoginValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const {
        email,
        password,
      } = req.body;


      const result =
        await customerLogin(
          email,
          password
        );


      sendSuccess(
        res,
        result,
        'Login successful.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// CUSTOMER FORGOT PASSWORD
// ======================================================

router.post(
  '/customer/forgot-password',
  authLimiter,
  forgotPasswordValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      /*
       * IMPORTANT:
       * User enters EMAIL.
       *
       * Backend finds the customer's
       * registered mobile number and
       * sends OTP there.
       */

      const {
        email,
      } = req.body;


      await sendPasswordResetOtp(
        email
      );


      /*
       * Do not reveal whether the
       * account exists.
       */

      sendSuccess(
        res,
        null,
        'If the account exists, a password reset OTP has been sent to the registered mobile number.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// VERIFY PASSWORD RESET OTP
// ======================================================

router.post(
  '/customer/verify-reset-otp',
  authLimiter,
  mobileOtpValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const {
        email,
        otp,
      } = req.body;


      await verifyPasswordResetOtp(
        email,
        otp
      );


      sendSuccess(
        res,
        null,
        'OTP verified successfully.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// RESET CUSTOMER PASSWORD
// ======================================================

router.post(
  '/customer/reset-password',
  authLimiter,
  resetPasswordValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const {
        email,
        otp,
        newPassword,
      } = req.body;


      await resetPassword(
        email,
        otp,
        newPassword
      );


      sendSuccess(
        res,
        null,
        'Password reset successfully. You can now login.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// BUSINESS LOGIN
// ======================================================

router.post(
  '/business/login',
  authLimiter,
  businessLoginValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const {
        email,
        password,
      } = req.body;


      const result =
        await businessLogin(
          email,
          password
        );


      sendSuccess(
        res,
        result,
        'Business login successful.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// SORTER LOGIN
//
// Staff sign in with a username. Rate limited and role
// pinned exactly like the customer and business logins.
// ======================================================

router.post(
  '/sorter/login',
  authLimiter,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const {
        username,
        password,
      } = req.body;


      if (!username || !password) {
        sendError(
          res,
          'Username and password are required.',
          400
        );

        return;
      }


      const result =
        await sorterLogin(
          username,
          password
        );


      sendSuccess(
        res,
        result,
        'Sorter login successful.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// GET CURRENT USER
// ======================================================

router.get(
  '/me',
  authenticate,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const authReq =
        req as AuthenticatedRequest;


      // Pass the token role so the right id-space is queried.
      const user =
        await getMe(
          authReq.user!.id,
          authReq.user!.role
        );


      sendSuccess(
        res,
        user,
        'Profile fetched successfully.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// UPDATE PROFILE
// ======================================================

router.put(
  '/profile',
  authenticate,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const authReq =
        req as AuthenticatedRequest;


      const user =
        await updateProfile(
          authReq.user!.id,
          req.body
        );


      sendSuccess(
        res,
        user,
        'Profile updated successfully.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// CHANGE PASSWORD
// ======================================================

router.post(
  '/change-password',
  authenticate,
  changePasswordValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const authReq =
        req as AuthenticatedRequest;


      const {
        currentPassword,
        newPassword,
      } = req.body;


      await changePassword(
        authReq.user!.id,
        currentPassword,
        newPassword
      );


      sendSuccess(
        res,
        null,
        'Password changed successfully.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// LOGOUT
// ======================================================

router.post(
  '/logout',
  authenticate,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      sendSuccess(
        res,
        null,
        'Logged out successfully.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// BUSINESS REGISTRATION
// ======================================================

router.post(
  '/business/register',
  authLimiter,
  businessRegisterValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      const result =
        await businessRegister(
          req.body
        );

      sendSuccess(
        res,
        result,
        'Business registration successful.',
        201
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// ENTRY OTP SEND
// ======================================================

router.post(
  '/entry/send-otp',
  authLimiter,
  entryOtpSendValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      await sendEntryOtp(
        req.body.mobile
      );

      sendSuccess(
        res,
        null,
        'Entry OTP sent successfully.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// ENTRY OTP VERIFY
// ======================================================

router.post(
  '/entry/verify-otp',
  authLimiter,
  entryOtpVerifyValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      await verifyEntryOtp(
        req.body.mobile,
        req.body.otp
      );

      sendSuccess(
        res,
        null,
        'Entry OTP verified successfully.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// ENTRY OTP RESEND
// ======================================================

router.post(
  '/entry/resend-otp',
  authLimiter,
  entryOtpSendValidation,
  handleValidation,

  async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {

    try {

      await resendEntryOtp(
        req.body.mobile
      );

      sendSuccess(
        res,
        null,
        'Entry OTP resent successfully.'
      );

    } catch (error) {
      next(error);
    }
  }
);


// ======================================================
// EXPORT
// ======================================================

export default router;