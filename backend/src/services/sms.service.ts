import { logger } from '../utils/logger';
import { config } from '../config/env';

export interface SmsProvider {
  sendOtpSms(mobile: string, otp: string): Promise<boolean>;
}

class DevelopmentSmsProvider implements SmsProvider {
  async sendOtpSms(mobile: string, otp: string): Promise<boolean> {
    // For DEVELOPMENT ONLY
    logger.info(`[SMS DEV] OTP generated for development: ${otp} (for mobile: ${mobile})`);
    return true;
  }
}

class ProductionSmsProvider implements SmsProvider {
  async sendOtpSms(mobile: string, otp: string): Promise<boolean> {
    const provider = config.OTP_PROVIDER;
    const apiKey = config.OTP_API_KEY;
    const senderId = config.OTP_SENDER_ID;

    if (!provider || !apiKey) {
      logger.warn(`[SMS PROD] OTP_PROVIDER or OTP_API_KEY is not configured. Falling back to log.`);
      logger.info(`[SMS PROD Fallback] OTP for ${mobile}: ${otp}`);
      return true;
    }

    try {
      logger.info(`[SMS PROD] Sending SMS to ${mobile} via ${provider}`);
      // NOTE: Here you would integrate with the actual provider (e.g. MSG91, Twilio, Gupshup)
      // Example for a generic API:
      // await fetch(`https://api.smsprovider.com/send`, {
      //   method: 'POST',
      //   headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ to: mobile, from: senderId, message: `Your Swachham OTP is ${otp}` })
      // });
      return true;
    } catch (error) {
      logger.error(`[SMS PROD] Failed to send SMS:`, error);
      throw new Error('Failed to send OTP SMS');
    }
  }
}

export const smsService: SmsProvider =
  config.NODE_ENV === 'production'
    ? new ProductionSmsProvider()
    : new DevelopmentSmsProvider();
