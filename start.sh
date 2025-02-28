#!/bin/bash
# Start script for the AI Agent Testing Center
# Launches Flask app, Celery worker, and Redis

# Terminal colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the absolute path of the current directory
CURRENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo -e "${BLUE}Working directory: ${CURRENT_DIR}${NC}"

# Trap ctrl-c and call cleanup
trap cleanup INT

# Function to clean up all processes on exit
cleanup() {
    echo -e "${YELLOW}Shutting down services...${NC}"
    
    # Kill background processes
    if [ ! -z "$REDIS_PID" ]; then
        echo -e "${YELLOW}Stopping Redis...${NC}"
        kill $REDIS_PID 2>/dev/null
    fi
    if [ ! -z "$CELERY_PID" ]; then
        echo -e "${YELLOW}Stopping Celery...${NC}"
        kill $CELERY_PID 2>/dev/null
    fi
    if [ ! -z "$FLASK_PID" ]; then
        echo -e "${YELLOW}Stopping Flask...${NC}"
        kill $FLASK_PID 2>/dev/null
    fi
    
    echo -e "${GREEN}All services stopped.${NC}"
    exit 0
}

# Check if Redis is already running
redis_running() {
    nc -z localhost 6379 >/dev/null 2>&1
    return $?
}

# Set environment variables
export PYTHONPATH=$CURRENT_DIR

# Start Redis if not already running
if redis_running; then
    echo -e "${GREEN}Redis is already running.${NC}"
else
    echo -e "${BLUE}Starting Redis server...${NC}"
    if command -v redis-server >/dev/null 2>&1; then
        redis-server > $CURRENT_DIR/redis.log 2>&1 &
        REDIS_PID=$!
    else
        echo -e "${RED}Redis not found. Make sure it's installed.${NC}"
        echo -e "${YELLOW}You may need to install Redis:${NC}"
        echo -e "${YELLOW}  macOS: brew install redis${NC}"
        echo -e "${YELLOW}  Ubuntu/Debian: sudo apt install redis-server${NC}"
        cleanup
    fi
    
    # Wait for Redis to start
    echo -e "${BLUE}Waiting for Redis to start...${NC}"
    sleep 2
    
    if ! redis_running; then
        echo -e "${RED}Failed to start Redis. Check redis.log for details.${NC}"
        cleanup
    fi
fi

# Start Celery worker
echo -e "${BLUE}Starting Celery worker...${NC}"
cd $CURRENT_DIR
celery -A celery_app.celery worker --loglevel=info > $CURRENT_DIR/celery.log 2>&1 &
CELERY_PID=$!

# Wait for Celery to initialize
echo -e "${BLUE}Waiting for Celery to initialize...${NC}"
sleep 3

# Start Flask app
echo -e "${BLUE}Starting Flask app...${NC}"
cd $CURRENT_DIR
python run.py > $CURRENT_DIR/flask.log 2>&1 &
FLASK_PID=$!

echo -e "${GREEN}All services started!${NC}"
echo -e "${GREEN}App is running at: http://localhost:5000${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services.${NC}"
echo -e "${BLUE}Logs are being written to:${NC}"
echo -e "${BLUE}- Redis: $CURRENT_DIR/redis.log${NC}"
echo -e "${BLUE}- Celery: $CURRENT_DIR/celery.log${NC}"
echo -e "${BLUE}- Flask: $CURRENT_DIR/flask.log${NC}"

# Function to follow log files in real-time
follow_logs() {
    local log_file=$1
    local prefix=$2
    
    if [ -f "$log_file" ]; then
        tail -f "$log_file" | while read line; do
            echo -e "${prefix}: $line"
        done &
    fi
}

# Follow log files
follow_logs "$CURRENT_DIR/redis.log" "${RED}REDIS${NC}" &
REDIS_LOG_PID=$!

follow_logs "$CURRENT_DIR/celery.log" "${YELLOW}CELERY${NC}" &
CELERY_LOG_PID=$!

follow_logs "$CURRENT_DIR/flask.log" "${GREEN}FLASK${NC}" &
FLASK_LOG_PID=$!

# Wait until one of the processes exits or user presses Ctrl+C
while kill -0 $REDIS_PID 2>/dev/null && kill -0 $CELERY_PID 2>/dev/null && kill -0 $FLASK_PID 2>/dev/null; do
    sleep 1
done

# If we get here, one of the processes has exited
echo -e "${RED}One of the processes has exited unexpectedly.${NC}"
cleanup