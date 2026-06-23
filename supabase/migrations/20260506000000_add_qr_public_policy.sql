CREATE POLICY "QR publico lectura"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'comprobantes' AND name = 'qr-altoke.jpeg');
