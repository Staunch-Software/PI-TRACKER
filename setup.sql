CREATE USER pi_tracker_app WITH PASSWORD 'choose-a-strong-password-here';
CREATE DATABASE pi_tracker OWNER pi_tracker_app;
\c pi_tracker
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT ALL PRIVILEGES ON DATABASE pi_tracker TO pi_tracker_app;
