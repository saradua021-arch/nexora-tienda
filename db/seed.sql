INSERT INTO products (id,name,category,price,old_price,stock,image_url) VALUES
(1,'Portátil Vektor 14″ Ryzen 7','Portátiles',3290000,3690000,12,'img/1.jpg'),
(2,'Portátil Forge 16″ RTX 4060','Portátiles',5890000,6390000,5,'img/2.jpg'),
(3,'Smartphone Orbit X 256 GB','Móviles',2190000,2490000,20,'img/3.jpg'),
(4,'Smartphone Lite A5 128 GB','Móviles',899000,NULL,34,'img/4.jpg'),
(5,'Audífonos Pulse ANC inalámbricos','Audio',459000,549000,41,'img/5.jpg'),
(6,'Parlante Boom Mini resistente al agua','Audio',229000,NULL,27,NULL),
(7,'Smartwatch Pulse S2 GPS','Wearables',679000,790000,18,'img/7.jpg'),
(8,'Monitor Vision 27″ 2K 165 Hz','Monitores',1190000,1390000,9,'img/8.jpg'),
(9,'Teclado mecánico Kairo RGB','Accesorios',289000,NULL,50,'img/9.jpg'),
(10,'Mouse inalámbrico Glide Pro','Accesorios',149000,179000,60,'img/10.jpg')
ON CONFLICT (id) DO NOTHING;
SELECT setval(pg_get_serial_sequence('products','id'), (SELECT MAX(id) FROM products));
