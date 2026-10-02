// Must run before anything reads the environment: the test database is used
// instead of the working one, whatever .env says.
process.env.APP_ENV = 'test';
process.env.DB_NAME = 'studio_desk_test';
