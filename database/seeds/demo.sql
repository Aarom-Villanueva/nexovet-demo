-- Datos sintéticos; teléfonos/documentos reales deliberadamente ausentes.
-- UUID estables: repetir agrega solo lo que falta, sin truncar tablas ni modificar registros.
INSERT INTO business_settings(singleton,name,address,is_demo)
VALUES(true,'NexoVet · Veterinaria de demostración','Dirección ficticia · Lima, Perú',true)
ON CONFLICT DO NOTHING;

INSERT INTO users(id,name,email,role)
VALUES
  (md5('user:admin')::uuid,'Camila Torres','admin@example.invalid','admin'),
  (md5('user:reception')::uuid,'Luis Mendoza','recepcion@example.invalid','reception'),
  (md5('user:vet1')::uuid,'Valeria Rojas','valeria@example.invalid','veterinarian'),
  (md5('user:vet2')::uuid,'Diego Salas','diego@example.invalid','veterinarian')
ON CONFLICT DO NOTHING;

INSERT INTO clients(id,name,email,address)
SELECT md5('client:'||i)::uuid,
  (ARRAY['Lucía','Mateo','Valentina','Gabriel','Camila','Joaquín','Mariana','Sebastián'])[(i-1)%8+1]
  ||' '||(ARRAY['Torres','Rojas','Mendoza','Salas','Flores','Vargas','Castro','Paredes'])[(i-1)/8%8+1]
  ||' · Demo '||lpad(i::text,3,'0'),
  'cliente'||i||'@example.invalid','Domicilio ficticio '||i
FROM generate_series(1,320) AS i ON CONFLICT DO NOTHING;

INSERT INTO pets(id,client_id,name,species,breed,sex,birth_date)
SELECT md5('pet:'||i)::uuid,md5('client:'||((i-1)%320+1))::uuid,
  (ARRAY['Luna','Max','Nala','Simba','Milo','Kira','Coco','Toby','Mía','Bruno'])[(i-1)%10+1]||' '||lpad(i::text,3,'0'),
  CASE WHEN i%3=0 THEN 'cat' ELSE 'dog' END,
  CASE WHEN i%3=0 THEN 'Mestizo felino' ELSE 'Mestizo canino' END,
  CASE WHEN i%2=0 THEN 'female' ELSE 'male' END,
  date '2020-01-01'+(i%1800)
FROM generate_series(1,400) AS i ON CONFLICT DO NOTHING;

INSERT INTO services(id,name,duration_minutes,price)
VALUES
  (md5('service:consult')::uuid,'Consulta general',30,50),
  (md5('service:vaccine')::uuid,'Vacunación',30,65),
  (md5('service:control')::uuid,'Control veterinario',30,35),
  (md5('service:grooming')::uuid,'Baño y cuidado',60,45),
  (md5('service:ultrasound')::uuid,'Ecografía',45,90),
  (md5('service:dental')::uuid,'Evaluación dental',30,50)
ON CONFLICT DO NOTHING;

INSERT INTO product_categories(id,name)
SELECT md5('category:'||i)::uuid,name FROM unnest(ARRAY['Alimentos','Higiene','Accesorios','Farmacia']) WITH ORDINALITY AS t(name,i)
ON CONFLICT DO NOTHING;
INSERT INTO suppliers(id,name,email)
SELECT md5('supplier:'||i)::uuid,'Proveedor ficticio '||i,'proveedor'||i||'@example.invalid'
FROM generate_series(1,6) AS i ON CONFLICT DO NOTHING;

INSERT INTO products(id,sku,name,category_id,sale_price,minimum_stock)
SELECT md5('product:'||i)::uuid,'NV-'||lpad(i::text,4,'0'),
  (ARRAY['Alimento de demostración','Champú de demostración','Accesorio de demostración','Producto veterinario ficticio'])[(i-1)%4+1]||' '||lpad(i::text,3,'0'),
  md5('category:'||((i-1)%4+1))::uuid,10+(i%45)*2.50,5
FROM generate_series(1,320) AS i ON CONFLICT DO NOTHING;

INSERT INTO stock_movements(id,product_id,quantity,kind,reason,recorded_by)
SELECT md5('opening:'||i)::uuid,md5('product:'||i)::uuid,CASE WHEN i%7=0 THEN 3 ELSE 20 END,
  'opening','Saldo inicial ficticio',md5('user:admin')::uuid
FROM generate_series(1,320) AS i ON CONFLICT DO NOTHING;

INSERT INTO appointments(id,pet_id,professional_id,service_id,starts_at,ends_at,status,reason,created_by)
SELECT md5('appointment:'||i)::uuid,md5('pet:'||i)::uuid,
  md5('user:vet'||CASE WHEN i%2=0 THEN '2' ELSE '1' END)::uuid,
  md5('service:consult')::uuid,
  (((now() AT TIME ZONE 'America/Lima')::date+((i-1)/6))
    + make_time((ARRAY[9,10,11,14,15,16])[(i-1)%6+1],0,0)) AT TIME ZONE 'America/Lima',
  ((((now() AT TIME ZONE 'America/Lima')::date+((i-1)/6))
    + make_time((ARRAY[9,10,11,14,15,16])[(i-1)%6+1],30,0))) AT TIME ZONE 'America/Lima',
  CASE WHEN i%2=0 THEN 'confirmed' ELSE 'scheduled' END,'Consulta de demostración',md5('user:reception')::uuid
FROM generate_series(1,36) AS i ON CONFLICT DO NOTHING;

INSERT INTO follow_up_tasks(id,client_id,pet_id,assigned_to,title,due_at,status,completed_at)
SELECT md5('task:'||i)::uuid,md5('client:'||i)::uuid,md5('pet:'||i)::uuid,md5('user:reception')::uuid,
  (ARRAY['Control de vacunación','Seguimiento de consulta','Recordatorio de revisión'])[(i-1)%3+1],
  now()+make_interval(days=>i-6),CASE WHEN i%4=0 THEN 'completed' ELSE 'pending' END,
  CASE WHEN i%4=0 THEN now() ELSE NULL END
FROM generate_series(1,24) AS i ON CONFLICT DO NOTHING;

INSERT INTO purchase_orders(id,number,supplier_id,created_by)
SELECT md5('purchase:'||i)::uuid,'OC-DEMO-'||i,md5('supplier:'||i)::uuid,md5('user:admin')::uuid
FROM generate_series(1,3) AS i ON CONFLICT DO NOTHING;
INSERT INTO purchase_order_lines(id,purchase_order_id,product_id,quantity,unit_cost)
SELECT md5('purchase-line:'||i)::uuid,md5('purchase:'||i)::uuid,md5('product:'||i)::uuid,10,8.25
FROM generate_series(1,3) AS i ON CONFLICT DO NOTHING;

INSERT INTO sales(id,number,client_id,created_by)
SELECT md5('sale:'||i)::uuid,'V-DEMO-'||i,md5('client:'||i)::uuid,md5('user:reception')::uuid
FROM generate_series(1,3) AS i ON CONFLICT DO NOTHING;
INSERT INTO sale_lines(id,sale_id,product_id,description,quantity,unit_price)
SELECT md5('sale-line:'||i)::uuid,md5('sale:'||i)::uuid,md5('product:'||i)::uuid,'Producto ficticio '||i,1,12.50
FROM generate_series(1,3) AS i ON CONFLICT DO NOTHING;
