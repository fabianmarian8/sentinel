# Workspaces Module

Complete CRUD implementation for workspace management in Sentinel Change Intelligence Platform.

## Features

- Full CRUD operations for workspaces
- Role-based authorization (owner, admin, member, viewer)
- Team collaboration with workspace members
- JWT authentication on all endpoints

## API Endpoints

### List Workspaces
```
GET /workspaces
Authorization: Bearer <token>
```
Returns all workspaces where authenticated user is a member or owner.

**Response:**
```json
[
  {
    "id": "clxyz...",
    "name": "My E-commerce Monitoring",
    "type": "ecommerce",
    "timezone": "Europe/Bratislava",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "role": "owner",
    "memberCount": 3
  }
]
```

### Create Workspace
```
POST /workspaces
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "My E-commerce Monitoring",
  "type": "ecommerce",
  "timezone": "Europe/Bratislava"
}
```

Creates new workspace and automatically adds creator as owner member.

**Response:**
```json
{
  "id": "clxyz...",
  "name": "My E-commerce Monitoring",
  "type": "ecommerce",
  "timezone": "Europe/Bratislava",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "role": "owner",
  "memberCount": 1
}
```

### Get Workspace
```
GET /workspaces/:id
Authorization: Bearer <token>
```

Returns detailed workspace information including members list.

**Authorization:** User must be a member of the workspace.

**Response:**
```json
{
  "id": "clxyz...",
  "name": "My E-commerce Monitoring",
  "type": "ecommerce",
  "timezone": "Europe/Bratislava",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "ownerId": "clusr...",
  "role": "owner",
  "memberCount": 3,
  "sourceCount": 15,
  "members": [
    {
      "id": "clmem...",
      "userId": "clusr...",
      "email": "owner@example.com",
      "role": "owner",
      "joinedAt": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "clmem2...",
      "userId": "clusr2...",
      "email": "member@example.com",
      "role": "member",
      "joinedAt": "2024-01-02T00:00:00.000Z"
    }
  ]
}
```

### Update Workspace
```
PATCH /workspaces/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Updated Workspace Name",
  "timezone": "America/New_York"
}
```

**Authorization:** Owner or admin only.

All fields are optional.

**Response:**
```json
{
  "id": "clxyz...",
  "name": "Updated Workspace Name",
  "type": "ecommerce",
  "timezone": "America/New_York",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "memberCount": 3
}
```

### Delete Workspace
```
DELETE /workspaces/:id
Authorization: Bearer <token>
```

**Authorization:** Owner only.

Cascade deletes all members, sources, rules, and related data.

**Response:**
```json
{
  "message": "Workspace deleted successfully"
}
```

### Add Member
```
POST /workspaces/:id/members
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": "clusr...",
  "role": "member"
}
```

**Authorization:** Owner or admin only.

**Roles:**
- `owner` - Full control (automatically assigned to creator)
- `admin` - Can manage workspace and members
- `member` - Can view and edit workspace content
- `viewer` - Read-only access

**Response:**
```json
{
  "id": "clmem...",
  "userId": "clusr...",
  "email": "newmember@example.com",
  "role": "member",
  "joinedAt": "2024-01-03T00:00:00.000Z"
}
```

### Remove Member
```
DELETE /workspaces/:id/members/:userId
Authorization: Bearer <token>
```

**Authorization:** Owner or admin only.

Cannot remove workspace owner.

**Response:**
```json
{
  "message": "Member removed successfully"
}
```

## DTOs

### CreateWorkspaceDto
```typescript
{
  name: string;       // 1-100 characters
  type: WorkspaceType; // 'ecommerce' | 'competitor' | 'procurement'
  timezone?: string;   // Optional, defaults to 'Europe/Bratislava'
}
```

### UpdateWorkspaceDto
```typescript
{
  name?: string;
  type?: WorkspaceType;
  timezone?: string;
}
```

### AddMemberDto
```typescript
{
  userId: string;     // UUID
  role: WorkspaceRole; // 'admin' | 'member' | 'viewer'
}
```

## Authorization Rules

| Action | Owner | Admin | Member | Viewer |
|--------|-------|-------|--------|--------|
| View workspace | ✓ | ✓ | ✓ | ✓ |
| Update workspace | ✓ | ✓ | ✗ | ✗ |
| Delete workspace | ✓ | ✗ | ✗ | ✗ |
| Add members | ✓ | ✓ | ✗ | ✗ |
| Remove members | ✓ | ✓ | ✗ | ✗ |

## Database Relations

```
Workspace
├── owner (User)
├── members[] (WorkspaceMember)
├── sources[] (Source)
├── fetchProfiles[] (FetchProfile)
└── notificationChannels[] (NotificationChannel)

WorkspaceMember
├── workspace (Workspace)
└── user (User)
```

All relations use `onDelete: Cascade` for automatic cleanup.

## Service Methods

- `findAllByUser(userId)` - List all workspaces for user
- `create(userId, dto)` - Create workspace with owner member
- `findOne(id, userId)` - Get workspace with membership check
- `update(id, userId, dto)` - Update workspace (owner/admin)
- `remove(id, userId)` - Delete workspace (owner only)
- `addMember(workspaceId, userId, dto)` - Add member (owner/admin)
- `removeMember(workspaceId, userId, memberId)` - Remove member (owner/admin)

## Error Responses

- `401 Unauthorized` - Missing or invalid JWT token
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Workspace or user not found
- `409 Conflict` - User already member of workspace

## Example Usage

### Creating a workspace and inviting team
```bash
# 1. Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}'

# 2. Create workspace
curl -X POST http://localhost:3000/workspaces \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My E-commerce Monitoring",
    "type": "ecommerce",
    "timezone": "Europe/Bratislava"
  }'

# 3. Add team member
curl -X POST http://localhost:3000/workspaces/<workspace-id>/members \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<user-id>",
    "role": "member"
  }'
```

## Files Structure

```
workspaces/
├── workspaces.module.ts      # NestJS module definition
├── workspaces.controller.ts  # REST API endpoints
├── workspaces.service.ts     # Business logic
├── index.ts                  # Module exports
├── README.md                 # This file
└── dto/
    ├── create-workspace.dto.ts
    ├── update-workspace.dto.ts
    └── add-member.dto.ts
```

## Implementation Notes

1. **Automatic Owner Member**: When workspace is created, the creator is automatically added as a workspace member with `owner` role.

2. **Member Count**: All list/detail responses include `memberCount` for quick reference.

3. **Source Count**: Detail view includes `sourceCount` showing number of monitoring sources.

4. **Timezone Support**: Workspaces support custom timezones for scheduling and reporting.

5. **Cascade Deletion**: Deleting workspace automatically removes all members, sources, and related data.

6. **Owner Protection**: Workspace owner cannot be removed from members list.

7. **Membership Check**: All operations verify user is a member before returning workspace data.
