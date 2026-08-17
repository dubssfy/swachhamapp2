import { query } from '../config/database';
import { logger } from '../utils/logger';

export interface Address {
  id: string;
  user_id: string;
  address_label?: string;
  full_address: string;
  house_flat?: string;
  area?: string;
  city: string;
  state: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AddressInput {
  address_label?: string;
  full_address: string;
  house_flat?: string;
  area?: string;
  city: string;
  state: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
}

async function getAddresses(userId: string): Promise<Address[]> {
  const result = await query<Address>(
    `SELECT id, user_id, address_label, full_address, house_flat, area, city, state, pincode, latitude, longitude, is_default, created_at, updated_at
     FROM customer_addresses
     WHERE user_id = ?
     ORDER BY is_default DESC, created_at DESC`,
    [userId]
  );
  return result.rows;
}

async function addAddress(userId: string, data: AddressInput): Promise<Address> {
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM customer_addresses WHERE user_id = ?`,
    [userId]
  );
  const isFirst = parseInt(countResult.rows[0]?.count || '0', 10) === 0;

  const insertResult = await query(
    `INSERT INTO customer_addresses 
     (user_id, address_label, full_address, house_flat, area, city, state, pincode, latitude, longitude, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      data.address_label || null,
      data.full_address,
      data.house_flat || null,
      data.area || null,
      data.city,
      data.state,
      data.pincode,
      data.latitude || null,
      data.longitude || null,
      isFirst
    ]
  );

  const addressId = insertResult.insertId!;

  const selectResult = await query<Address>(
    `SELECT * FROM customer_addresses WHERE id = ?`,
    [addressId]
  );

  const address = selectResult.rows[0];
  logger.info(`[AddressService] Address added for user ${userId}: ${address.id}`);
  return address;
}

async function updateAddress(
  userId: string,
  addressId: string,
  data: Partial<AddressInput>
): Promise<Address> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.address_label !== undefined) { fields.push(`address_label = ?`); values.push(data.address_label); }
  if (data.full_address !== undefined) { fields.push(`full_address = ?`); values.push(data.full_address); }
  if (data.house_flat !== undefined) { fields.push(`house_flat = ?`); values.push(data.house_flat); }
  if (data.area !== undefined) { fields.push(`area = ?`); values.push(data.area); }
  if (data.city !== undefined) { fields.push(`city = ?`); values.push(data.city); }
  if (data.state !== undefined) { fields.push(`state = ?`); values.push(data.state); }
  if (data.pincode !== undefined) { fields.push(`pincode = ?`); values.push(data.pincode); }
  if (data.latitude !== undefined) { fields.push(`latitude = ?`); values.push(data.latitude); }
  if (data.longitude !== undefined) { fields.push(`longitude = ?`); values.push(data.longitude); }

  if (fields.length === 0) {
    const existing = await query<Address>(
      `SELECT * FROM customer_addresses WHERE id = ? AND user_id = ?`,
      [addressId, userId]
    );
    if (!existing.rows[0]) throw new Error('Address not found');
    return existing.rows[0];
  }

  fields.push(`updated_at = NOW()`);
  values.push(addressId, userId);

  await query(
    `UPDATE customer_addresses
     SET ${fields.join(', ')}
     WHERE id = ? AND user_id = ?`,
    values
  );

  const updatedResult = await query<Address>(
    `SELECT * FROM customer_addresses WHERE id = ?`,
    [addressId]
  );

  const address = updatedResult.rows[0];
  if (!address) throw new Error('Address not found or access denied');
  return address;
}

async function deleteAddress(userId: string, addressId: string): Promise<void> {
  const result = await query(
    `DELETE FROM customer_addresses WHERE id = ? AND user_id = ?`,
    [addressId, userId]
  );
  if (result.rowCount === 0) {
    throw new Error('Address not found or access denied');
  }
  logger.info(`[AddressService] Address ${addressId} deleted for user ${userId}`);
}

async function setDefault(userId: string, addressId: string): Promise<Address> {
  const ownerCheck = await query<{ id: string }>(
    `SELECT id FROM customer_addresses WHERE id = ? AND user_id = ?`,
    [addressId, userId]
  );
  if (ownerCheck.rows.length === 0) {
    throw new Error('Address not found or access denied');
  }

  await query(
    `UPDATE customer_addresses SET is_default = false WHERE user_id = ?`,
    [userId]
  );

  await query(
    `UPDATE customer_addresses SET is_default = true, updated_at = NOW()
     WHERE id = ?`,
    [addressId]
  );

  const result = await query<Address>(
    `SELECT * FROM customer_addresses WHERE id = ?`,
    [addressId]
  );

  logger.info(`[AddressService] Address ${addressId} set as default for user ${userId}`);
  return result.rows[0];
}

export { getAddresses, addAddress, updateAddress, deleteAddress, setDefault };
