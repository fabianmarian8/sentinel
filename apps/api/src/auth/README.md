# Auth Module

Complete JWT-based authentication module for Sentinel API.

## Overview

This module provides user authentication using JWT (JSON Web Tokens) and bcrypt password hashing. It includes user registration, login, and profile retrieval endpoints with comprehensive security features.

## Features

- ✅ User registration with email validation
- ✅ JWT-based authentication
- ✅ Bcrypt password hashing (12 rounds)
- ✅ Password validation (minimum 8 characters)
- ✅ Email uniqueness validation
- ✅ Protected routes with JWT guard
- ✅ Automatic token generation on registration/login
- ✅ Last login tracking
- ✅ Comprehensive error handling
- ✅ Full test coverage

## API Endpoints

### POST /auth/register

Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response (201 Created):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "clxxxx1234567890",
    "email": "user@example.com"
  }
}
```

**Errors:**
- `409 Conflict` - User with this email already exists
- `400 Bad Request` - Invalid email format or password too short

### POST /auth/login

Authenticate user and return JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```

**Response (200 OK):**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "clxxxx1234567890",
    "email": "user@example.com"
  }
}
```

**Errors:**
- `401 Unauthorized` - Invalid email or password

### GET /auth/me

Get current user profile (requires authentication).

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "id": "clxxxx1234567890",
  "email": "user@example.com",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "lastLoginAt": "2025-01-15T14:45:00.000Z"
}
```

**Errors:**
- `401 Unauthorized` - Invalid or missing token

## File Structure

```
auth/
├── README.md                    # This file
├── auth.module.ts              # Module definition with JWT setup
├── auth.controller.ts          # REST endpoints
├── auth.controller.spec.ts     # Controller tests
├── auth.service.ts             # Business logic
├── auth.service.spec.ts        # Service tests
├── index.ts                    # Module exports
├── dto/
│   ├── register.dto.ts         # Registration input validation
│   ├── login.dto.ts            # Login input validation
│   └── auth-response.dto.ts    # Response type definitions
└── strategies/
    └── jwt.strategy.ts         # Passport JWT strategy
```

## Usage in Other Modules

### Protecting Routes

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Controller('protected')
export class ProtectedController {
  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getData() {
    return { data: 'This is protected' };
  }
}
```

### Getting Current User

```typescript
import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Controller('protected')
export class ProtectedController {
  @Get()
  @UseGuards(AuthGuard('jwt'))
  async getData(@Req() req: any) {
    const user = req.user; // Current authenticated user
    return { userId: user.id };
  }
}
```

## Security Features

### Password Hashing

- Uses bcrypt with 12 salt rounds
- Passwords are never stored in plain text
- Hash verification during login

### JWT Configuration

- Secret key from environment variable (`JWT_SECRET`)
- Configurable expiration (default: 7 days)
- Token includes user ID and email
- Stateless authentication

### Input Validation

- Email format validation
- Password minimum length (8 characters)
- Duplicate email prevention
- Proper error messages (no information leakage)

## Environment Variables

Required environment variables (configured in `apps/api/.env`):

```env
JWT_SECRET=your-secret-key-here
JWT_EXPIRATION=7d
```

## Testing

Run auth module tests:

```bash
npm test -- auth
```

Current test coverage:
- ✅ User registration (success & conflict cases)
- ✅ User login (success & error cases)
- ✅ Password validation
- ✅ User validation
- ✅ Controller endpoints
- ✅ All error scenarios

## Dependencies

- `@nestjs/jwt` - JWT token generation
- `@nestjs/passport` - Authentication middleware
- `passport-jwt` - JWT strategy
- `bcrypt` - Password hashing
- `class-validator` - DTO validation

## Integration with Database

The module uses the existing PrismaService to interact with the User model:

```prisma
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String    @map("password_hash")
  createdAt    DateTime  @default(now()) @map("created_at")
  lastLoginAt  DateTime? @map("last_login_at")

  // Relations...
}
```

## Future Enhancements

Potential improvements for v2:

- [ ] Refresh tokens
- [ ] Email verification
- [ ] Password reset flow
- [ ] OAuth integration (Google, GitHub)
- [ ] Two-factor authentication
- [ ] Rate limiting on login attempts
- [ ] Session management
- [ ] Account lockout after failed attempts
- [ ] Password strength meter
- [ ] Remember me functionality
