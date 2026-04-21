module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method !== 'GET') return res.status(405).end()
  res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY })
}
