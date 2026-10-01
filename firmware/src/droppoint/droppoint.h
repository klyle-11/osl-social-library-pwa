// Shared state between the drop point's main loop (radio) and its web server task.
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

#include "osl_store.h"

extern osl::Store store;
extern String nodeId;

// The store is used from the web server task and the radio loop: hold this while touching it.
struct StoreLock {
    StoreLock();
    ~StoreLock();
};

void fillStatus(JsonDocument& d);  // must be called holding StoreLock
bool allowAuthor(void* ctx, const char* author);
bool webStart();
