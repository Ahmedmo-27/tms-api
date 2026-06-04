import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TheMindSpace API',
      version: '1.0.0',
      description: 'REST API for TheMindSpace app',
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 5000}`,
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    tags: [
      {
        name: 'Authentication',
        description: 'API endpoints for user authentication'
      },
      {
        name: 'Users',
        description: 'API endpoints for user management'
      },
      {
        name: 'Member Classes',
        description: 'API endpoints for member class operations'
      },
      {
        name: 'Member Profile',
        description: 'API endpoints for member profile management'
      },
      {
        name: 'Member Packages',
        description: 'API endpoints for member package management'
      }
    ]
  },
  apis: [
    './src/routes/*.ts', 
    './src/models/*.ts', 
    './src/controllers/**/*.ts'  // Include all controllers in subdirectories
  ],
};

const specs = swaggerJsdoc(options);

export { specs, swaggerUi };
