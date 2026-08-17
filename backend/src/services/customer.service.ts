import { query } from '../config/database';
import { logger } from '../utils/logger';

export interface CustomerProfile {
  id: string;
  user_id: string;
  username: string;
  profile_image_url?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerProfileInput {
  username: string;
  profile_image_url?: string;
}

export async function getCustomerProfile(userId: string): Promise<CustomerProfile | null> {
  const result = await query<CustomerProfile>(
    `SELECT * FROM customer_profiles WHERE user_id = ?`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function createOrUpdateCustomerProfile(userId: string, data: CustomerProfileInput): Promise<CustomerProfile> {
  const existing = await getCustomerProfile(userId);

  if (existing) {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.username !== undefined) { fields.push(`username = ?`); values.push(data.username); }
    if (data.profile_image_url !== undefined) { fields.push(`profile_image_url = ?`); values.push(data.profile_image_url); }

    if (fields.length > 0) {
      fields.push(`updated_at = NOW()`);
      values.push(userId);

      await query(
        `UPDATE customer_profiles SET ${fields.join(', ')} WHERE user_id = ?`,
        values
      );
    }
  } else {
    await query(
      `INSERT INTO customer_profiles (user_id, username, profile_image_url) VALUES (?, ?, ?)`,
      [userId, data.username, data.profile_image_url || null]
    );
  }

  const updatedProfile = await getCustomerProfile(userId);
  if (!updatedProfile) throw new Error('Failed to create or update profile');
  
  logger.info(`[CustomerService] Profile updated for user ${userId}`);
  return updatedProfile;
}
