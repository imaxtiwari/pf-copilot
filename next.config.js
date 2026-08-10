/** @type {import('next').NextConfig} */
const nextConfig = {
    // Empty turbopack config silences the webpack/turbopack conflict warning
    turbopack: {},
    webpack: (config, { isServer }) => {
        if (isServer) {
            config.externals.push('pg-native')
        }
        return config
    },
}
module.exports = nextConfig
