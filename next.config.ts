import type { NextConfig } from 'next';
const securityHeaders=[
 {key:'X-Content-Type-Options',value:'nosniff'},
 {key:'X-Frame-Options',value:'DENY'},
 {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
 {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
 {key:'Content-Security-Policy',value:"default-src 'self'; img-src 'self' data: https:; media-src 'self' https: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"}
];
const nextConfig:NextConfig={output:'standalone',reactStrictMode:true,async headers(){return [{source:'/(.*)',headers:securityHeaders}]}};
export default nextConfig;
