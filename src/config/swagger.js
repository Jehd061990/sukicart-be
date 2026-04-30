const swaggerUi = require("swagger-ui-express");

const swaggerDocument = {
  openapi: "3.0.3",
  info: {
    title: "SukiCart Backend API",
    version: "1.0.0",
    description: "Interactive API docs for SukiCart endpoints.",
  },
  servers: [
    {
      url: "http://localhost:5000",
      description: "Local development server",
    },
  ],
  tags: [
    { name: "Health" },
    { name: "Auth" },
    { name: "Admin" },
    { name: "Protected" },
    { name: "Products" },
    { name: "Deliveries" },
    { name: "Users" },
    { name: "POS" },
    { name: "Sessions" },
    { name: "Orders" },
    { name: "Sellers" },
    { name: "Buyers" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          message: { type: "string", example: "Something went wrong" },
        },
      },
      UserSummary: {
        type: "object",
        properties: {
          id: { type: "string", example: "67f0f0f0f0f0f0f0f0f0f0f0" },
          name: { type: "string", example: "Jane Doe" },
          email: { type: "string", example: "jane@example.com" },
          role: {
            type: "string",
            enum: ["BUYER", "SELLER", "POS", "RIDER", "ADMIN"],
            example: "BUYER",
          },
          status: {
            type: "string",
            enum: ["active", "inactive", "pending"],
            example: "active",
          },
        },
      },
      RegisterRequest: {
        type: "object",
        required: ["name", "email", "password", "role"],
        properties: {
          name: { type: "string", example: "Jane Doe" },
          email: { type: "string", example: "jane@example.com" },
          password: { type: "string", example: "secret123" },
          role: {
            type: "string",
            enum: ["BUYER", "SELLER", "RIDER"],
            example: "BUYER",
          },
        },
      },
      LoginRequest: {
        type: "object",
        required: ["identifier", "password"],
        properties: {
          identifier: {
            type: "string",
            example: "jane@example.com",
            description: "Email or POS username",
          },
          password: { type: "string", example: "secret123" },
          deviceId: {
            type: "string",
            example: "7f90f4a5-1dad-4c6d-b8d2-f2f17b28620f",
          },
          deviceName: {
            type: "string",
            example: "Cashier Tablet 1",
          },
        },
      },
      POSUsage: {
        type: "object",
        properties: {
          active: { type: "number", example: 1 },
          total: { type: "number", example: 3 },
        },
      },
      AuthSuccessResponse: {
        type: "object",
        properties: {
          message: { type: "string", example: "Login successful" },
          accessToken: {
            type: "string",
            example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          },
          refreshToken: {
            type: "string",
            example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          },
          token: {
            type: "string",
            example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
          },
          user: { $ref: "#/components/schemas/UserSummary" },
          sessionId: {
            type: ["string", "null"],
            example: "6812f9fd4c7b9c90e8ce8f6a",
          },
          posUsage: {
            oneOf: [
              { $ref: "#/components/schemas/POSUsage" },
              { type: "null" },
            ],
          },
        },
      },
      POSCreateRequest: {
        type: "object",
        required: ["posName"],
        properties: {
          posName: { type: "string", example: "Cashier 1" },
          username: { type: "string", example: "cashier.one" },
          password: { type: "string", example: "StrongPass!23" },
          autoGeneratePassword: { type: "boolean", example: true },
        },
      },
      POSUpdateRequest: {
        type: "object",
        properties: {
          posName: { type: "string", example: "Cashier 2" },
          username: { type: "string", example: "cashier.two" },
          password: { type: "string", example: "NewPass!123" },
        },
      },
      UpgradePOSSlotsRequest: {
        type: "object",
        required: ["additionalSlots"],
        properties: {
          additionalSlots: { type: "number", example: 2 },
        },
      },
      UpgradePOSSlotsResponse: {
        type: "object",
        properties: {
          message: { type: "string" },
          subscription: {
            type: "object",
            properties: {
              totalSlots: { type: "number", example: 5 },
              loginPolicy: {
                type: "string",
                enum: ["REJECT", "INVALIDATE_OLDEST"],
              },
            },
          },
          usage: { $ref: "#/components/schemas/POSUsage" },
          note: { type: "string" },
        },
      },
      DeviceSession: {
        type: "object",
        properties: {
          id: { type: "string", example: "6812f9fd4c7b9c90e8ce8f6a" },
          userId: { type: "string", example: "6812f9fd4c7b9c90e8ce8f6b" },
          role: { type: "string", enum: ["SELLER", "POS", "ADMIN", "BUYER", "RIDER"] },
          deviceId: { type: "string", example: "7f90f4a5-1dad-4c6d-b8d2-f2f17b28620f" },
          deviceName: { type: "string", example: "Cashier Tablet 1" },
          ipAddress: { type: "string", example: "127.0.0.1" },
          lastActiveAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      POSAccount: {
        type: "object",
        properties: {
          id: { type: "string", example: "6812f9fd4c7b9c90e8ce8f6b" },
          posName: { type: "string", example: "Cashier 1" },
          username: { type: "string", example: "cashier.one" },
          status: { type: "string", enum: ["active", "inactive", "pending"] },
          isDeactivated: { type: "boolean", example: false },
          createdAt: { type: "string", format: "date-time" },
          activeSession: {
            oneOf: [
              { $ref: "#/components/schemas/DeviceSession" },
              { type: "null" },
            ],
          },
        },
      },
      POSCreateResponse: {
        type: "object",
        properties: {
          message: { type: "string", example: "POS account created successfully" },
          pos: { $ref: "#/components/schemas/POSAccount" },
          generatedPassword: { type: "string", example: "R4nd0mPass!23" },
          usage: { $ref: "#/components/schemas/POSUsage" },
        },
      },
      POSListResponse: {
        type: "object",
        properties: {
          usage: { $ref: "#/components/schemas/POSUsage" },
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/POSAccount" },
          },
        },
      },
      SessionListResponse: {
        type: "object",
        properties: {
          data: {
            type: "array",
            items: { $ref: "#/components/schemas/DeviceSession" },
          },
        },
      },
      Product: {
        type: "object",
        properties: {
          _id: { type: "string", example: "67f0f0f0f0f0f0f0f0f0f0a1" },
          name: { type: "string", example: "Tomato" },
          price: { type: "number", example: 45.5 },
          stock: { type: "number", example: 100 },
          unit: { type: "string", example: "kg" },
          category: {
            type: "string",
            enum: ["vegetables", "meat", "fish"],
            example: "vegetables",
          },
          image: { type: "string", example: "https://example.com/tomato.jpg" },
          sellerId: {
            oneOf: [
              { type: "string", example: "67f0f0f0f0f0f0f0f0f0f0b2" },
              {
                type: "object",
                properties: {
                  _id: { type: "string" },
                  name: { type: "string" },
                  email: { type: "string" },
                  role: { type: "string" },
                },
              },
            ],
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      AddProductRequest: {
        type: "object",
        required: ["name", "price", "stock", "unit", "category"],
        properties: {
          name: { type: "string", example: "Tomato" },
          price: { type: "number", example: 45.5 },
          stock: { type: "number", example: 100 },
          unit: { type: "string", example: "kg" },
          category: {
            type: "string",
            enum: ["vegetables", "meat", "fish"],
            example: "vegetables",
          },
          image: { type: "string", example: "https://example.com/tomato.jpg" },
        },
      },
      EditProductRequest: {
        type: "object",
        properties: {
          name: { type: "string", example: "Tomato Premium" },
          price: { type: "number", example: 50 },
          stock: { type: "number", example: 80 },
          unit: { type: "string", example: "kg" },
          category: {
            type: "string",
            enum: ["vegetables", "meat", "fish"],
            example: "vegetables",
          },
          image: {
            type: "string",
            example: "https://example.com/tomato-new.jpg",
          },
        },
      },
      ProductListResponse: {
        type: "object",
        properties: {
          count: { type: "number", example: 1 },
          products: {
            type: "array",
            items: { $ref: "#/components/schemas/Product" },
          },
        },
      },
      OrderItemRequest: {
        type: "object",
        required: ["productId", "quantity"],
        properties: {
          productId: { type: "string", example: "67f0f0f0f0f0f0f0f0f0f0a1" },
          quantity: { type: "number", example: 2 },
        },
      },
      CreateOrderRequest: {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/OrderItemRequest" },
          },
        },
      },
      CreatePOSOrderRequest: {
        type: "object",
        required: ["items", "paymentMethod"],
        properties: {
          paymentMethod: { type: "string", example: "cash" },
          items: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/OrderItemRequest" },
          },
        },
      },
      AssignRiderRequest: {
        type: "object",
        required: ["riderId"],
        properties: {
          riderId: { type: "string", example: "67f0f0f0f0f0f0f0f0f0f0c3" },
        },
      },
      UpdateOrderStatusRequest: {
        type: "object",
        required: ["status"],
        properties: {
          status: {
            type: "string",
            enum: [
              "pending",
              "accepted",
              "preparing",
              "out_for_delivery",
              "delivered",
            ],
            example: "preparing",
          },
        },
      },
      Order: {
        type: "object",
        properties: {
          _id: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: { type: "string" },
                name: { type: "string" },
                unit: { type: "string" },
                price: { type: "number" },
                quantity: { type: "number" },
                lineTotal: { type: "number" },
              },
            },
          },
          total: { type: "number" },
          buyerId: { type: ["string", "null"] },
          sellerId: { type: "string" },
          riderId: { type: ["string", "null"] },
          type: { type: "string", enum: ["ONLINE", "POS"] },
          status: {
            type: "string",
            enum: [
              "pending",
              "accepted",
              "preparing",
              "out_for_delivery",
              "delivered",
            ],
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      OrderResponse: {
        type: "object",
        properties: {
          message: { type: "string" },
          order: { $ref: "#/components/schemas/Order" },
        },
      },
      MessageResponse: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
      },
      SellerRegisterRequest: {
        type: "object",
        required: [
          "fullName",
          "phoneNumber",
          "email",
          "password",
          "storeName",
          "storeType",
          "acceptTerms",
        ],
        properties: {
          fullName: { type: "string", example: "Juan Dela Cruz" },
          phoneNumber: { type: "string", example: "09171234567" },
          email: { type: "string", example: "seller@example.com" },
          password: { type: "string", example: "seller1234" },
          storeName: { type: "string", example: "Suki Gulayan" },
          storeType: {
            type: "string",
            enum: ["Gulay", "Karne", "Isda", "Mixed"],
            example: "Gulay",
          },
          marketLocation: { type: "string", example: "Carbon Market" },
          exactAddress: {
            type: "string",
            example: "Stall 12, Block B, Cebu City",
          },
          dtiPermit: {
            type: "string",
            format: "binary",
          },
          validId: {
            type: "string",
            format: "binary",
          },
          handleOwnDelivery: { type: "boolean", example: false },
          usePlatformRiders: { type: "boolean", example: true },
          acceptTerms: { type: "boolean", example: true },
        },
      },
      SellerRegisterResponse: {
        type: "object",
        properties: {
          message: {
            type: "string",
            example: "Registration successful! Waiting for approval.",
          },
          user: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              email: { type: "string" },
              role: { type: "string", example: "SELLER" },
            },
          },
          seller: {
            type: "object",
            properties: {
              id: { type: "string" },
              storeName: { type: "string" },
              storeType: { type: "string" },
              registrationStatus: { type: "string", example: "PENDING" },
            },
          },
        },
      },
      BuyerRegisterRequest: {
        type: "object",
        required: [
          "fullName",
          "phoneNumber",
          "password",
          "barangay",
          "streetAddress",
        ],
        properties: {
          fullName: { type: "string", example: "Maria Santos" },
          phoneNumber: { type: "string", example: "09171234567" },
          email: { type: "string", example: "buyer@example.com" },
          password: { type: "string", example: "buyer1234" },
          city: { type: "string", example: "Davao" },
          barangay: { type: "string", example: "Talomo" },
          streetAddress: {
            type: "string",
            example: "Purok 3, Door 4",
          },
          landmark: { type: "string", example: "Near chapel" },
          notes: { type: "string", example: "Leave at gate" },
        },
      },
      BuyerRegisterResponse: {
        type: "object",
        properties: {
          message: { type: "string", example: "Welcome! Start shopping now." },
          user: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              email: { type: ["string", "null"] },
              role: { type: "string", example: "BUYER" },
            },
          },
          buyer: {
            type: "object",
            properties: {
              id: { type: "string" },
              city: { type: "string" },
              barangay: { type: "string" },
              streetAddress: { type: "string" },
            },
          },
        },
      },
    },
  },
  paths: {
    "/": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        responses: {
          200: {
            description: "API is running",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "SukiCart auth API is running",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new user",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RegisterRequest" },
            },
          },
        },
        responses: {
          201: {
            description: "Registered successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthSuccessResponse" },
              },
            },
          },
          400: { description: "Validation error" },
          409: { description: "Email already exists" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login user",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Login successful",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthSuccessResponse" },
              },
            },
          },
          400: { description: "Validation error" },
          401: { description: "Invalid credentials" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Refresh access token",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["refreshToken"],
                properties: {
                  refreshToken: {
                    type: "string",
                    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Tokens refreshed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthSuccessResponse" },
              },
            },
          },
          401: { description: "Invalid refresh token" },
        },
      },
    },
    "/api/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get current user",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Current user",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user: { type: "object" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Logout current user",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Logout successful",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MessageResponse" },
              },
            },
          },
          401: { description: "Unauthorized" },
        },
      },
    },
    "/api/admin/dashboard-stats": {
      get: {
        tags: ["Admin"],
        summary: "Get admin dashboard summary cards",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Dashboard metrics",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    totalUsers: { type: "number", example: 245 },
                    totalSellers: { type: "number", example: 37 },
                    totalOrders: { type: "number", example: 991 },
                    totalRevenue: { type: "number", example: 125340.5 },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden (admin only)" },
        },
      },
    },
    "/api/admin/users": {
      get: {
        tags: ["Admin"],
        summary: "List all platform users",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Users list" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden (admin only)" },
        },
      },
    },
    "/api/admin/sellers": {
      get: {
        tags: ["Admin"],
        summary: "List seller registrations",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Sellers list" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden (admin only)" },
        },
      },
    },
    "/api/admin/sellers/{sellerProfileId}": {
      get: {
        tags: ["Admin"],
        summary: "View seller details",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sellerProfileId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Seller details" },
          400: { description: "Invalid seller profile id" },
          404: { description: "Seller not found" },
        },
      },
    },
    "/api/admin/sellers/{sellerProfileId}/status": {
      patch: {
        tags: ["Admin"],
        summary: "Approve or reject seller registration",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "sellerProfileId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: {
                  status: {
                    type: "string",
                    enum: ["PENDING", "APPROVED", "REJECTED"],
                    example: "APPROVED",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Status updated" },
          400: { description: "Validation error" },
          404: { description: "Seller not found" },
        },
      },
    },
    "/api/admin/riders": {
      get: {
        tags: ["Admin"],
        summary: "List riders",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Riders list" },
        },
      },
      post: {
        tags: ["Admin"],
        summary: "Create rider account",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "email", "password", "phoneNumber"],
                properties: {
                  name: { type: "string", example: "Rider One" },
                  email: { type: "string", example: "rider@example.com" },
                  password: { type: "string", example: "rider1234" },
                  phoneNumber: { type: "string", example: "09171234567" },
                  isActive: { type: "boolean", example: true },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Rider created" },
          409: { description: "Email already exists" },
        },
      },
    },
    "/api/admin/riders/{userId}/toggle-active": {
      patch: {
        tags: ["Admin"],
        summary: "Toggle rider active/inactive",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Rider status updated" },
          404: { description: "Rider not found" },
        },
      },
    },
    "/api/admin/riders/{userId}": {
      delete: {
        tags: ["Admin"],
        summary: "Remove rider",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Rider removed" },
          404: { description: "Rider not found" },
        },
      },
    },
    "/api/admin/buyers": {
      get: {
        tags: ["Admin"],
        summary: "List buyers",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Buyers list" },
        },
      },
    },
    "/api/admin/buyers/{userId}/disable": {
      patch: {
        tags: ["Admin"],
        summary: "Disable buyer account",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: { description: "Buyer disabled" },
          404: { description: "Buyer not found" },
        },
      },
    },
    "/api/admin/orders": {
      get: {
        tags: ["Admin"],
        summary: "List orders with optional status filter",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: [
                "all",
                "pending",
                "accepted",
                "preparing",
                "out_for_delivery",
                "delivered",
              ],
            },
          },
        ],
        responses: {
          200: { description: "Orders list" },
          400: { description: "Invalid status" },
        },
      },
    },
    "/api/admin/orders/{orderId}/status": {
      patch: {
        tags: ["Admin"],
        summary: "Update order status",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "orderId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: {
                  status: {
                    type: "string",
                    enum: [
                      "pending",
                      "accepted",
                      "preparing",
                      "out_for_delivery",
                      "delivered",
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Order status updated" },
          404: { description: "Order not found" },
        },
      },
    },
    "/api/protected/admin-only": {
      get: {
        tags: ["Protected"],
        summary: "Admin-only test route",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Admin payload",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string", example: "Welcome admin" },
                    user: { type: "object" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
        },
      },
    },
    "/api/products": {
      get: {
        tags: ["Products"],
        summary: "List products",
        parameters: [
          {
            name: "category",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["vegetables", "meat", "fish"],
            },
          },
        ],
        responses: {
          200: {
            description: "Products list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProductListResponse" },
              },
            },
          },
          400: { description: "Invalid category filter" },
          500: { description: "Server error" },
        },
      },
      post: {
        tags: ["Products"],
        summary: "Create product (SELLER only)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AddProductRequest" },
            },
          },
        },
        responses: {
          201: {
            description: "Product created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "Product added successfully",
                    },
                    product: { $ref: "#/components/schemas/Product" },
                  },
                },
              },
            },
          },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/products/{id}": {
      put: {
        tags: ["Products"],
        summary: "Edit product (SELLER only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EditProductRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Product updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "Product updated successfully",
                    },
                    product: { $ref: "#/components/schemas/Product" },
                  },
                },
              },
            },
          },
          400: { description: "Invalid product id or payload" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Product not found" },
          500: { description: "Server error" },
        },
      },
      delete: {
        tags: ["Products"],
        summary: "Delete product (SELLER only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Product deleted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MessageResponse" },
              },
            },
          },
          400: { description: "Invalid product id" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Product not found" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/deliveries/{deliveryId}/status": {
      patch: {
        tags: ["Deliveries"],
        summary: "Update delivery status (RIDER only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "deliveryId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Delivery status updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "Delivery 123 status updated",
                    },
                    rider: { type: "string" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
        },
      },
    },
    "/api/users": {
      get: {
        tags: ["Users"],
        summary: "List users (ADMIN only)",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "User list response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string", example: "List users (admin)" },
                    admin: { type: "string" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
        },
      },
    },
    "/api/users/{id}/role": {
      patch: {
        tags: ["Users"],
        summary: "Update user role (ADMIN only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Role updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "User <id> role updated",
                    },
                    admin: { type: "string" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
        },
      },
    },
    "/api/users/{id}": {
      delete: {
        tags: ["Users"],
        summary: "Delete user (ADMIN only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "User deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string", example: "User <id> deleted" },
                    admin: { type: "string" },
                  },
                },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
        },
      },
    },
    "/api/pos/orders": {
      post: {
        tags: ["POS"],
        summary: "Create POS order (SELLER or POS)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreatePOSOrderRequest" },
            },
          },
        },
        responses: {
          201: {
            description: "POS order created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrderResponse" },
              },
            },
          },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Product not found" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/pos/create": {
      post: {
        tags: ["POS"],
        summary: "Create POS account (SELLER only)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/POSCreateRequest" },
            },
          },
        },
        responses: {
          201: {
            description: "POS account created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/POSCreateResponse" },
              },
            },
          },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          409: { description: "Slot limit or duplicate username" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/pos/list": {
      get: {
        tags: ["POS"],
        summary: "List POS accounts and usage (SELLER only)",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "POS account list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/POSListResponse" },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/pos/subscription/upgrade": {
      post: {
        tags: ["POS"],
        summary: "Upgrade POS subscription slots (SELLER only)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpgradePOSSlotsRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "POS slots upgraded",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpgradePOSSlotsResponse" },
              },
            },
          },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/pos/{id}": {
      put: {
        tags: ["POS"],
        summary: "Edit POS account fields (SELLER only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/POSUpdateRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "POS account updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MessageResponse" },
              },
            },
          },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "POS account not found" },
          409: { description: "Username already in use" },
          500: { description: "Server error" },
        },
      },
      delete: {
        tags: ["POS"],
        summary: "Deactivate POS account (SELLER only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "POS deactivated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MessageResponse" },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "POS account not found" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/sessions": {
      get: {
        tags: ["Sessions"],
        summary: "List active sessions (SELLER or POS)",
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: "Active session list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SessionListResponse" },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
        },
      },
    },
    "/api/sessions/{id}": {
      delete: {
        tags: ["Sessions"],
        summary: "Force logout a session (SELLER or POS own session)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Session revoked",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MessageResponse" },
              },
            },
          },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Session not found" },
        },
      },
    },
    "/api/orders": {
      post: {
        tags: ["Orders"],
        summary: "Create online order (BUYER only)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateOrderRequest" },
            },
          },
        },
        responses: {
          201: {
            description: "Order created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrderResponse" },
              },
            },
          },
          400: { description: "Validation error" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Product not found" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/orders/{orderId}/accept": {
      patch: {
        tags: ["Orders"],
        summary: "Accept order (SELLER only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "orderId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: "Order accepted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrderResponse" },
              },
            },
          },
          400: { description: "Invalid order id or invalid order state" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Order not found" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/orders/{orderId}/assign-rider": {
      patch: {
        tags: ["Orders"],
        summary: "Assign rider to order (SELLER or ADMIN)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "orderId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AssignRiderRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Rider assigned",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrderResponse" },
              },
            },
          },
          400: { description: "Invalid order id or rider" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Order not found" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/orders/{orderId}/status": {
      patch: {
        tags: ["Orders"],
        summary: "Update order status (SELLER only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "orderId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateOrderStatusRequest" },
            },
          },
        },
        responses: {
          200: {
            description: "Order status updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrderResponse" },
              },
            },
          },
          400: { description: "Invalid order id or status" },
          401: { description: "Unauthorized" },
          403: { description: "Forbidden" },
          404: { description: "Order not found" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/sellers/register": {
      post: {
        tags: ["Sellers"],
        summary: "Register seller and store profile",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: { $ref: "#/components/schemas/SellerRegisterRequest" },
            },
          },
        },
        responses: {
          201: {
            description: "Seller registration submitted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SellerRegisterResponse" },
              },
            },
          },
          400: { description: "Validation error" },
          409: { description: "Email already exists" },
          500: { description: "Server error" },
        },
      },
    },
    "/api/buyers/register": {
      post: {
        tags: ["Buyers"],
        summary: "Register buyer profile",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BuyerRegisterRequest" },
            },
          },
        },
        responses: {
          201: {
            description: "Buyer registration successful",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BuyerRegisterResponse" },
              },
            },
          },
          400: { description: "Validation error" },
          409: { description: "Email already exists" },
          500: { description: "Server error" },
        },
      },
    },
  },
};

const setupSwagger = (app) => {
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
};

module.exports = {
  setupSwagger,
  swaggerDocument,
};
