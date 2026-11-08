//! Zero-dependency building blocks shared by both sidecar builds:
//! the loopback HTTP server, the JSON codec, and the provider contract.
//! The upstream (`fanqie`) build lives in `sidecar-upstream/` and reuses these.

pub mod http;
pub mod json;
pub mod provider;
