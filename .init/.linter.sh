#!/bin/bash
cd /home/kavia/workspace/code-generation/sketchquest-106351-90e98ad5/doodle_finder_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

