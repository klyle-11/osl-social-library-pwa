// Shared state between the drop point's main loop (radio) and its web server task.
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

#include "osl_api.h"
#include "osl_store.h"

// The store and presence are used from the web server task and the radio loop:
// hold this while touching either (osl::Api touches both).
struct StoreLock {
    StoreLock();
    ~StoreLock();
};

osl::Api& api();
const char* libraryAddress();  // "http://192.168.1.50:8080" or "https://library.example.org"
bool webStart();
