# Swachham — Premium Laundry Mobile Application

<div align="center">
  <h3>🧺 SWACHHAM</h3>
  <p><em>Premium Laundry Care — Clean. Fresh. Delivered.</em></p>
</div>

---

## 📖 Project Overview

Swachham is a production-ready laundry service mobile application built with **React Native (Expo)**, **Express.js**, and **PostgreSQL**. The app enables customers to browse laundry services, manage a cart, place orders, and track their laundry through every step of the cleaning process — in real time.

### Key Features
- 🛒 **Full Cart System** — Browse services, manage quantities, apply coupons
- 📦 **Order Management** — Place orders with pickup/delivery scheduling
- 🔴 **Real-Time Tracking** — Watch your laundry move through each production stage via Socket.IO
- 🏭 **Production Workflow** — Backend API for staff to update production status (Received → Sorting → Washing → Drying → Ironing → Folding → QC → Packed → Ready)
- 🔔 **In-App Notifications** — Live status updates as notifications
- 👤 **Full Auth** — JWT-based registration, login, profile management
- 📍 **Address Management** — Multiple saved addresses with default selection

---

## 🏗 Technology Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native (Expo SDK 51) + TypeScript |
| State Management | Zustand + TanStack Query |
| Navigation | React Navigation v6 |
| HTTP Client | Axios |
| Real-Time | Socket.IO Client |
| Backend | Node.js + Express.js + TypeScript |
| Database | PostgreSQL 15 |
| Authentication | JWT (jsonwebtoken) + bcrypt |
| Real-Time Server | Socket.IO |
| Security | Helmet, CORS, express-rate-limit |
| Logging | Winston + Morgan |
| Validation | express-validator |

---

## 📁 Folder Structure

```
swachham/
├── mobile/                        # Expo React Native App
│   ├── App.tsx                    # Root app component
│   ├── app.json                   # Expo configuration
│   ├── package.json
│   └── src/
│       ├── components/
│       │   ├── common/            # Button, Input, Card, Badge, Toast, etc.
│       │   ├── home/              # CategoryCard, ServiceCard, BannerCarousel
│       │   ├── cart/              # CartItem, PricingSummary
│       │   ├── orders/            # OrderCard
│       │   └── tracking/          # TrackingTimeline
│       ├── screens/
│       │   ├── auth/              # Splash, Onboarding, Login, Register
│       │   ├── home/              # Home, Category, ServiceDetail
│       │   ├── cart/              # Cart, Checkout
│       │   ├── orders/            # Orders, OrderDetail
│       │   ├── tracking/          # Tracking
│       │   └── profile/           # Profile, EditProfile, Addresses, Notifications
│       ├── navigation/            # All navigators + type definitions
│       ├── services/              # API layer (api, authApi, cartApi, orderApi, etc.)
│       ├── store/                 # Zustand stores (auth, cart)
│       ├── hooks/                 # useCart, useOrders, useTracking
│       ├── constants/             # theme, api, orderStatus
│       └── types/                 # TypeScript interfaces
│
├── backend/                       # Express.js API Server
│   ├── src/
│   │   ├── config/               # database.ts, env.ts
│   │   ├── controllers/          # auth, service, cart, order, production, address, notification
│   │   ├── middleware/           # auth.ts, errorHandler.ts, validate.ts, rateLimiter.ts
│   │   ├── routes/               # All route files
│   │   ├── services/             # Business logic layer
│   │   ├── sockets/              # Socket.IO setup
│   │   ├── validators/           # express-validator chains
│   │   └── utils/                # logger, response, jwt, orderNumber
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
└── database/
    ├── migrations/
    │   └── 001_initial_schema.sql
    └── seeds/
        └── 001_seed_data.sql
```

---

## 🗄 PostgreSQL Setup

### Prerequisites
- PostgreSQL 15+ installed and running
- A database user with CREATE DATABASE privileges

### Create Database

```bash
psql -U postgres
CREATE DATABASE swachham_db;
\q
```

### Run Migrations

```bash
psql -U postgres -d swachham_db -f database/migrations/001_initial_schema.sql
```

### Run Seed Data

```bash
psql -U postgres -d swachham_db -f database/seeds/001_seed_data.sql
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` in the `backend/` folder:

```bash
cp backend/.env.example backend/.env
```

Then edit `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/swachham_db
PORT=5000
NODE_ENV=development
JWT_SECRET=your_super_secret_jwt_key
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your_refresh_secret
JWT_REFRESH_EXPIRES_IN=30d
CLIENT_URL=http://localhost:3000
SOCKET_CORS_ORIGIN=*
```

---

## 🚀 Backend — Installation & Running

```bash
cd backend
npm install
npm run dev
```

Backend will start on `http://localhost:5000`

Health check: `GET http://localhost:5000/health`

### Build for Production
```bash
npm run build
npm start
```

---

## 📱 Mobile — Installation & Running

### Prerequisites
- Node.js 20+
- Expo CLI: `npm install -g expo-cli`
- Android Studio (for Android emulator) or Xcode (for iOS simulator)
- Expo Go app on physical device

### Install & Run

```bash
cd mobile
npm install
npx expo start
```

Then press:
- `a` for Android emulator
- `i` for iOS simulator  
- Scan QR code with Expo Go on physical device

### Configure API URL

Edit `mobile/src/constants/api.ts`:
- **Android Emulator**: Use `http://10.0.2.2:5000`
- **iOS Simulator**: Use `http://localhost:5000`
- **Physical Device**: Use your machine's local IP, e.g. `http://192.168.1.x:5000`

---

## 📚 API Documentation

### Base URL
```
http://localhost:5000/api
```

### Authentication
All protected endpoints require:
```
Authorization: Bearer <jwt_token>
```

### Auth Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | No | Register new user |
| POST | `/auth/login` | No | Login |
| POST | `/auth/logout` | Yes | Logout |
| GET | `/auth/me` | Yes | Get current user |
| PUT | `/auth/profile` | Yes | Update profile |
| PUT | `/auth/change-password` | Yes | Change password |

### Services
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/services` | No | List services (paginated) |
| GET | `/services/popular` | No | Popular services |
| GET | `/services/categories` | No | All categories |
| GET | `/services/:id` | No | Service detail |

### Cart
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/cart` | Yes | Get user cart |
| POST | `/cart/items` | Yes | Add item to cart |
| PUT | `/cart/items/:id` | Yes | Update item quantity |
| DELETE | `/cart/items/:id` | Yes | Remove item |
| DELETE | `/cart` | Yes | Clear cart |
| POST | `/cart/validate-coupon` | Yes | Validate coupon code |

### Orders
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/orders` | Yes | User's orders |
| POST | `/orders` | Yes | Create order |
| GET | `/orders/:id` | Yes | Order detail |
| PUT | `/orders/:id/cancel` | Yes | Cancel order |
| GET | `/orders/:id/tracking` | Yes | Order tracking data |
| GET | `/orders/:id/status-history` | Yes | Full status history |

### Production (PRODUCTION/ADMIN role)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/production/orders` | Yes | All production orders |
| GET | `/production/orders/:id` | Yes | Production order detail |
| POST | `/production/orders/:id/status` | Yes | Update production status |

### Addresses
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/addresses` | Yes | User addresses |
| POST | `/addresses` | Yes | Add address |
| PUT | `/addresses/:id` | Yes | Update address |
| DELETE | `/addresses/:id` | Yes | Delete address |
| PUT | `/addresses/:id/set-default` | Yes | Set default |

### Notifications
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/notifications` | Yes | User notifications |
| PUT | `/notifications/:id/read` | Yes | Mark read |
| PUT | `/notifications/read-all` | Yes | Mark all read |
| GET | `/notifications/unread-count` | Yes | Unread count |

---

## 🔌 Socket.IO Architecture

### Connection
```javascript
const socket = io('http://localhost:5000', {
  auth: { token: '<jwt_token>' }
});
```

### Events — Client → Server
```javascript
// Join room for a specific order (call when opening tracking)
socket.emit('join_order_room', { orderId: 'uuid-here' });

// Leave order room (call when closing tracking)
socket.emit('leave_order_room', { orderId: 'uuid-here' });

// Join user room for global notifications (call on app start)
socket.emit('join_user_room', { userId: 'uuid-here' });
```

### Events — Server → Client
```javascript
// When order status changes
socket.on('order_status_updated', (data) => {
  // data: { orderId, status, timestamp, statusHistory }
});

// When production status changes
socket.on('production_status_updated', (data) => {
  // data: { orderId, productionStatus, timestamp }
});

// When notification arrives
socket.on('notification_received', (data) => {
  // data: { title, body, type, orderId }
});
```

### Room Naming Convention
- `order:{orderId}` — Used for per-order real-time updates
- `user:{userId}` — Used for per-user notifications

---

## 📦 Order Lifecycle

```
ORDER_PLACED
    ↓ (pickup scheduled)
PICKUP_SCHEDULED
    ↓ (delivery agent assigned)
PICKUP_ASSIGNED
    ↓ (agent picks up)
PICKED_UP
    ↓ (arrives at facility)
RECEIVED_AT_FACILITY  ←→ [Production starts here]
    ↓
SORTING
    ↓
WASHING
    ↓
DRYING
    ↓
IRONING
    ↓
QUALITY_CHECK
    ↓
READY_FOR_DELIVERY
    ↓ (delivery agent assigned)
DELIVERY_ASSIGNED
    ↓ (agent departs)
OUT_FOR_DELIVERY
    ↓
DELIVERED
    ↓
COMPLETED
```

---

## 🏭 Production Workflow

Valid status transitions (invalid transitions are rejected):

```
RECEIVED → SORTING → WASHING → DRYING → IRONING → FOLDING → QUALITY_CHECK → PACKED → READY_FOR_DELIVERY
```

### Update Production Status (Staff API)

```bash
curl -X POST http://localhost:5000/api/production/orders/{orderId}/status \
  -H "Authorization: Bearer <production_user_token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "WASHING", "notes": "Started washing batch #3"}'
```

This will:
1. Validate the transition is allowed
2. Update `production_orders.current_status`
3. Insert a record in `production_status_history`
4. Map and update `orders.status`
5. Insert a record in `order_status_history`
6. Emit `order_status_updated` Socket.IO event to `order:{orderId}` room
7. Emit `production_status_updated` Socket.IO event
8. The customer's mobile app receives the update instantly without refreshing

---

## 🧪 Running Tests

```bash
cd backend
npm test
```

Test coverage includes:
- User registration & login
- JWT authentication middleware
- Service retrieval
- Cart operations (add, update, remove)
- Order creation with transaction
- Order tracking data
- Production status updates
- Invalid status transition rejection
- Socket.IO event emission

---

## 🔒 Security

- Passwords hashed with **bcrypt** (10 rounds)
- JWT tokens stored in **Expo SecureStore** on device
- All routes protected by authentication middleware
- Role-based authorization (USER, ADMIN, PRODUCTION, DELIVERY)
- SQL injection prevented via **parameterized queries** (`$1`, `$2`)
- **Helmet** for HTTP security headers
- **CORS** configured for specific origins
- **Rate limiting** (100 req/15min default, 10 req/15min for auth)
- No credentials in source code (`.env` + `.gitignore`)
- Input validation with `express-validator` on all POST/PUT routes

---

## 🚀 Deployment Notes

### Backend
- Set `NODE_ENV=production`
- Use a process manager like **PM2**: `pm2 start dist/server.js`
- Use **Nginx** as reverse proxy
- Set up SSL with Let's Encrypt
- Use **connection pooling** (already configured via `pg.Pool`)

### Database
- Use managed PostgreSQL (e.g. Neon, Supabase, RDS, Railway)
- Enable SSL for database connection
- Set up automated backups

### Mobile
- Build with `npx expo build:android` / `npx expo build:ios`
- Or use **EAS Build**: `eas build --platform all`
- Update `API_BASE_URL` in `constants/api.ts` to production URL

---

## 📄 License

MIT — Swachham Laundry Application
