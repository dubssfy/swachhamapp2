import { query } from '../config/database';
import { logger } from '../utils/logger';

export interface Business {
  id: string;
  user_id: string;
  business_name: string;
  gst_number?: string;
  contact_person: string;
  contact_number: string;
  business_type?: string;
  is_verified: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface BusinessImage {
  id: string;
  business_id: string;
  image_url: string;
  is_primary: boolean;
  created_at: Date;
}

export interface BusinessInput {
  business_name: string;
  gst_number?: string;
  contact_person: string;
  contact_number: string;
  business_type?: string;
}

export async function getBusiness(userId: string): Promise<Business | null> {
  const result = await query<Business>(
    `SELECT * FROM businesses WHERE user_id = ?`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function createBusiness(userId: string, data: BusinessInput): Promise<Business> {
  const insertResult = await query(
    `INSERT INTO businesses (user_id, business_name, gst_number, contact_person, contact_number, business_type)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      data.business_name,
      data.gst_number || null,
      data.contact_person,
      data.contact_number,
      data.business_type || null
    ]
  );

  const businessId = insertResult.insertId!;
  
  const selectResult = await query<Business>(
    `SELECT * FROM businesses WHERE id = ?`,
    [businessId]
  );
  
  logger.info(`[BusinessService] Business created for user ${userId}: ${businessId}`);
  return selectResult.rows[0];
}

export async function updateBusiness(userId: string, data: Partial<BusinessInput>): Promise<Business> {
  const business = await getBusiness(userId);
  if (!business) throw new Error('Business not found');

  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.business_name !== undefined) { fields.push(`business_name = ?`); values.push(data.business_name); }
  if (data.gst_number !== undefined) { fields.push(`gst_number = ?`); values.push(data.gst_number); }
  if (data.contact_person !== undefined) { fields.push(`contact_person = ?`); values.push(data.contact_person); }
  if (data.contact_number !== undefined) { fields.push(`contact_number = ?`); values.push(data.contact_number); }
  if (data.business_type !== undefined) { fields.push(`business_type = ?`); values.push(data.business_type); }

  if (fields.length > 0) {
    fields.push(`updated_at = NOW()`);
    values.push(business.id);

    await query(
      `UPDATE businesses SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }

  const updatedResult = await query<Business>(
    `SELECT * FROM businesses WHERE id = ?`,
    [business.id]
  );

  return updatedResult.rows[0];
}

export async function addBusinessImage(businessId: string, imageUrl: string, isPrimary: boolean = false): Promise<BusinessImage> {
  const insertResult = await query(
    `INSERT INTO business_images (business_id, image_url, is_primary) VALUES (?, ?, ?)`,
    [businessId, imageUrl, isPrimary]
  );
  
  const imageId = insertResult.insertId!;
  
  const result = await query<BusinessImage>(
    `SELECT * FROM business_images WHERE id = ?`,
    [imageId]
  );
  return result.rows[0];
}

export async function getBusinessImages(businessId: string): Promise<BusinessImage[]> {
  const result = await query<BusinessImage>(
    `SELECT * FROM business_images WHERE business_id = ? ORDER BY is_primary DESC, created_at DESC`,
    [businessId]
  );
  return result.rows;
}

export async function deleteBusinessImage(imageId: string, businessId: string): Promise<void> {
  const result = await query(
    `DELETE FROM business_images WHERE id = ? AND business_id = ?`,
    [imageId, businessId]
  );
  if (result.rowCount === 0) {
    throw new Error('Image not found or access denied');
  }
}
