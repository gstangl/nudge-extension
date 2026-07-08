#!/bin/bash
echo "$(date +%T) native host spawned by: $(ps -o comm= -p $PPID)" >> /tmp/nudge-native.log
exec "/usr/local/bin/node" "/Users/gst/Developer/nudge-extension/bridge/native-host.mjs"
