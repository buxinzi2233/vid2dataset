//! Desktop binary entry point — thin wrapper around the library app.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    vid2dataset_lib::run();
}
