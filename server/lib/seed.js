import { config } from './config.js';
import { hashPassword, randomToken } from './auth.js';
import { nowIso } from './db.js';
import { DEFAULT_SETTINGS, setSettings } from './data.js';
import { computeMaterialLine } from '../../shared/calc.js';
import { parseDecimal, microToInput, workAmountKopecks } from '../../shared/money.js';

const WORKS = [
  ['Демонтаж плитки', 'Демонтаж', 'м²', 280, 'Аккуратный демонтаж старой плитки с сохранением основания.'],
  ['Демонтаж старых обоев', 'Демонтаж', 'м²', 120, ''],
  ['Демонтаж кирпичной перегородки', 'Демонтаж', 'м²', 650, ''],
  ['Демонтаж напольного покрытия', 'Демонтаж', 'м²', 160, ''],
  ['Вывоз строительного мусора', 'Демонтаж', 'м³', 950, 'Погрузка и вывоз, тара включена.'],
  ['Штукатурка стен по маякам', 'Черновые работы', 'м²', 650, 'Гипсовая штукатурка, толщина слоя до 30 мм.'],
  ['Шпаклёвка стен под покраску', 'Черновые работы', 'м²', 480, 'Два слоя финишной шпаклёвки.'],
  ['Стяжка пола', 'Черновые работы', 'м²', 590, 'Полусухая стяжка, толщина до 60 мм.'],
  ['Монтаж перегородок из ГКЛ', 'Черновые работы', 'м²', 780, 'Каркас, обшивка в два слоя, шумоизоляция.'],
  ['Гидроизоляция пола', 'Черновые работы', 'м²', 320, 'Обмазочная гидроизоляция в санузлах.'],
  ['Разводка электрики', 'Электрика', 'м²', 950, 'Штробы, кабель, подрозетники, щит.'],
  ['Установка розетки', 'Электрика', 'шт.', 450, ''],
  ['Установка выключателя', 'Электрика', 'шт.', 350, ''],
  ['Монтаж люстры', 'Электрика', 'шт.', 900, ''],
  ['Штробление стен', 'Электрика', 'пог. м', 400, ''],
  ['Разводка труб водоснабжения', 'Сантехника', 'пог. м', 900, 'Полипропилен, коллекторная схема.'],
  ['Установка унитаза', 'Сантехника', 'шт.', 2500, 'Инсталляция или напольный унитаз.'],
  ['Установка раковины с тумбой', 'Сантехника', 'шт.', 1800, ''],
  ['Установка душевой кабины', 'Сантехника', 'шт.', 4500, ''],
  ['Установка смесителя', 'Сантехника', 'шт.', 900, ''],
  ['Укладка плитки на пол', 'Плиточные работы', 'м²', 1100, ''],
  ['Укладка плитки на стены', 'Плиточные работы', 'м²', 1250, ''],
  ['Затирка швов', 'Плиточные работы', 'м²', 180, ''],
  ['Укладка керамогранита', 'Плиточные работы', 'м²', 1350, ''],
  ['Грунтовка стен', 'Отделочные работы', 'м²', 120, ''],
  ['Покраска стен', 'Отделочные работы', 'м²', 380, 'Два слоя, водоэмульсионная краска.'],
  ['Поклейка обоев', 'Отделочные работы', 'м²', 420, ''],
  ['Укладка ламината', 'Отделочные работы', 'м²', 450, ''],
  ['Монтаж плинтуса', 'Отделочные работы', 'пог. м', 180, ''],
  ['Натяжной потолок', 'Отделочные работы', 'м²', 750, 'Матовое полотно, профиль, монтаж.'],
  ['Установка межкомнатной двери', 'Отделочные работы', 'шт.', 4500, 'Полотно, коробка, наличники.'],
];

const MATERIALS = [
  {
    name: 'Штукатурка гипсовая', category: 'Смеси и растворы', purchaseUnit: 'мешок', packageSize: '30',
    consumptionUnit: 'кг', rate: '10', price: 450, description: 'Мешок 30 кг. Расход при слое 10 мм — около 10 кг/м².',
  },
  {
    name: 'Шпаклёвка финишная', category: 'Смеси и растворы', purchaseUnit: 'мешок', packageSize: '25',
    consumptionUnit: 'кг', rate: '1.5', price: 690, description: 'Мешок 25 кг, два слоя.',
  },
  {
    name: 'Стяжка самовыравнивающаяся', category: 'Смеси и растворы', purchaseUnit: 'мешок', packageSize: '25',
    consumptionUnit: 'кг', rate: '1.6', price: 520, description: 'Мешок 25 кг на 1 м² при слое 10 мм.',
  },
  {
    name: 'Плиточный клей', category: 'Смеси и растворы', purchaseUnit: 'мешок', packageSize: '25',
    consumptionUnit: 'кг', rate: '4', price: 380, description: 'Мешок 25 кг, гребёнка 8 мм.',
  },
  {
    name: 'Гидроизоляция обмазочная', category: 'Смеси и растворы', purchaseUnit: 'упаковка', packageSize: '20',
    consumptionUnit: 'кг', rate: '1.5', price: 1200, description: 'Два слоя.',
  },
  {
    name: 'Грунтовка глубокого проникновения', category: 'Отделочные материалы', purchaseUnit: 'канистра', packageSize: '10',
    consumptionUnit: 'л', rate: '0.15', price: 890, description: 'Канистра 10 л, расход на два слоя.',
  },
  {
    name: 'Краска для стен', category: 'Отделочные материалы', purchaseUnit: 'ведро', packageSize: '9',
    consumptionUnit: 'л', rate: '0.12', price: 3400, description: 'Ведро 9 л, два слоя.',
  },
  {
    name: 'Обои флизелиновые', category: 'Отделочные материалы', purchaseUnit: 'рулон', packageSize: '5.3',
    consumptionUnit: 'м²', rate: '1', price: 3200, description: 'Рулон 1,06 × 5 м, без подбора рисунка.',
  },
  {
    name: 'Плитка керамическая', category: 'Плитка и камень', purchaseUnit: 'упаковка', packageSize: '1.44',
    consumptionUnit: 'м²', rate: '1.1', price: 1450, description: 'Упаковка 1,44 м², запас 10%.',
  },
  {
    name: 'Керамогранит', category: 'Плитка и камень', purchaseUnit: 'упаковка', packageSize: '1.2',
    consumptionUnit: 'м²', rate: '1.1', price: 1900, description: 'Упаковка 1,2 м², запас 10%.',
  },
  {
    name: 'Ламинат 33 класс', category: 'Напольные покрытия', purchaseUnit: 'упаковка', packageSize: '2.2',
    consumptionUnit: 'м²', rate: '1.05', price: 2300, description: 'Упаковка 2,2 м², запас 5%.',
  },
  {
    name: 'Плинтус ПВХ', category: 'Напольные покрытия', purchaseUnit: 'шт.', packageSize: null,
    consumptionUnit: 'пог. м', rate: null, price: 320, description: 'Планка 2,5 м.',
  },
  {
    name: 'Кабель ВВГнг 3×2,5', category: 'Электрика', purchaseUnit: 'м', packageSize: null,
    consumptionUnit: 'пог. м', rate: '4', price: 95, description: 'Расход 4 м на 1 м² помещения.',
  },
  {
    name: 'Розетка с рамкой', category: 'Электрика', purchaseUnit: 'шт.', packageSize: null,
    consumptionUnit: 'шт.', rate: null, price: 420, description: '',
  },
  {
    name: 'Светильник потолочный', category: 'Электрика', purchaseUnit: 'шт.', packageSize: null,
    consumptionUnit: 'шт.', rate: null, price: 3800, description: '',
  },
  {
    name: 'Унитаз с инсталляцией', category: 'Сантехника', purchaseUnit: 'комплект', packageSize: null,
    consumptionUnit: 'шт.', rate: null, price: 12500, description: '',
  },
  {
    name: 'Раковина с тумбой', category: 'Сантехника', purchaseUnit: 'комплект', packageSize: null,
    consumptionUnit: 'шт.', rate: null, price: 9800, description: '',
  },
  {
    name: 'Душевая кабина', category: 'Сантехника', purchaseUnit: 'шт.', packageSize: null,
    consumptionUnit: 'шт.', rate: null, price: 24500, description: '',
  },
  {
    name: 'Смеситель для раковины', category: 'Сантехника', purchaseUnit: 'шт.', packageSize: null,
    consumptionUnit: 'шт.', rate: null, price: 4200, description: '',
  },
  {
    name: 'Труба полипропиленовая', category: 'Сантехника', purchaseUnit: 'шт.', packageSize: null,
    consumptionUnit: 'пог. м', rate: null, price: 380, description: 'Отрез 2 м.',
  },
  {
    name: 'Мешки для строительного мусора', category: 'Расходные материалы', purchaseUnit: 'упаковка', packageSize: null,
    consumptionUnit: 'шт.', rate: null, price: 260, description: 'Упаковка 10 шт.',
  },
];

const DEMO_PROJECTS = [
  {
    name: 'Квартира на Пресне',
    address: 'Москва, ул. Пресненская, 12, кв. 48',
    area: '62',
    description: 'Комплексный ремонт трёхкомнатной квартиры под ключ. Дизайн-проект согласован с заказчиком.',
    public: true,
    rooms: [
      {
        name: 'Кухня', area: '12',
        works: [
          ['Демонтаж плитки', 12], ['Демонтаж старых обоев', 12], ['Штукатурка стен по маякам', 32],
          ['Стяжка пола', 12], ['Гидроизоляция пола', 12], ['Разводка электрики', 12],
          ['Разводка труб водоснабжения', 8], ['Укладка плитки на пол', 12], ['Укладка плитки на стены', 18],
          ['Шпаклёвка стен под покраску', 32], ['Грунтовка стен', 32], ['Покраска стен', 32],
          ['Натяжной потолок', 12],
        ],
        materials: [
          ['Штукатурка гипсовая', { area: 32 }], ['Плиточный клей', { area: 30 }],
          ['Гидроизоляция обмазочная', { area: 12 }], ['Грунтовка глубокого проникновения', { area: 32 }],
          ['Краска для стен', { area: 32 }], ['Плитка керамическая', { area: 30 }],
          ['Розетка с рамкой', { qty: 6 }], ['Светильник потолочный', { qty: 2 }],
        ],
      },
      {
        name: 'Гостиная', area: '24',
        works: [
          ['Демонтаж старых обоев', 24], ['Штукатурка стен по маякам', 50], ['Стяжка пола', 24],
          ['Разводка электрики', 24], ['Укладка ламината', 24], ['Шпаклёвка стен под покраску', 50],
          ['Грунтовка стен', 50], ['Покраска стен', 50], ['Монтаж плинтуса', 18], ['Натяжной потолок', 24],
        ],
        materials: [
          ['Штукатурка гипсовая', { area: 50 }], ['Стяжка самовыравнивающаяся', { area: 24 }],
          ['Грунтовка глубокого проникновения', { area: 50 }], ['Краска для стен', { area: 50 }],
          ['Ламинат 33 класс', { area: 24 }], ['Плинтус ПВХ', { qty: 8 }], ['Светильник потолочный', { qty: 1 }],
        ],
      },
      {
        name: 'Спальня', area: '16',
        works: [
          ['Демонтаж старых обоев', 16], ['Штукатурка стен по маякам', 36], ['Укладка ламината', 16],
          ['Шпаклёвка стен под покраску', 36], ['Грунтовка стен', 36], ['Покраска стен', 36],
          ['Монтаж плинтуса', 14],
        ],
        materials: [
          ['Штукатурка гипсовая', { area: 36 }], ['Грунтовка глубокого проникновения', { area: 36 }],
          ['Краска для стен', { area: 36 }], ['Ламинат 33 класс', { area: 16 }], ['Плинтус ПВХ', { qty: 6 }],
        ],
      },
      {
        name: 'Санузел', area: '5',
        works: [
          ['Демонтаж плитки', 5], ['Гидроизоляция пола', 5], ['Разводка труб водоснабжения', 6],
          ['Укладка плитки на пол', 5], ['Укладка плитки на стены', 20], ['Затирка швов', 25],
          ['Установка унитаза', 1], ['Установка раковины с тумбой', 1], ['Установка душевой кабины', 1],
        ],
        materials: [
          ['Плиточный клей', { area: 25 }], ['Гидроизоляция обмазочная', { area: 5 }],
          ['Плитка керамическая', { area: 25 }], ['Унитаз с инсталляцией', { qty: 1 }],
          ['Раковина с тумбой', { qty: 1 }], ['Душевая кабина', { qty: 1 }], ['Смеситель для раковины', { qty: 1 }],
        ],
      },
      {
        name: 'Прихожая', area: '5',
        works: [
          ['Демонтаж старых обоев', 5], ['Штукатурка стен по маякам', 14], ['Укладка керамогранита', 5],
          ['Шпаклёвка стен под покраску', 14], ['Грунтовка стен', 14], ['Покраска стен', 14],
        ],
        materials: [
          ['Штукатурка гипсовая', { area: 14 }], ['Грунтовка глубокого проникновения', { area: 14 }],
          ['Краска для стен', { area: 14 }], ['Керамогранит', { area: 5 }],
        ],
      },
    ],
  },
  {
    name: 'Студия на Мясницкой',
    address: 'Москва, ул. Мясницкая, 24/7, кв. 12',
    area: '34',
    description: 'Ремонт студии в историческом центре. Черновые работы завершены, идёт чистовая отделка.',
    public: true,
    rooms: [
      {
        name: 'Студия', area: '28',
        works: [
          ['Демонтаж старых обоев', 28], ['Штукатурка стен по маякам', 44], ['Стяжка пола', 28],
          ['Разводка электрики', 28], ['Укладка ламината', 28], ['Шпаклёвка стен под покраску', 44],
          ['Грунтовка стен', 44], ['Покраска стен', 44], ['Монтаж плинтуса', 20], ['Натяжной потолок', 28],
        ],
        materials: [
          ['Штукатурка гипсовая', { area: 44 }], ['Стяжка самовыравнивающаяся', { area: 28 }],
          ['Грунтовка глубокого проникновения', { area: 44 }], ['Краска для стен', { area: 44 }],
          ['Ламинат 33 класс', { area: 28 }], ['Плинтус ПВХ', { qty: 9 }],
        ],
      },
      {
        name: 'Санузел', area: '4.2',
        works: [
          ['Демонтаж плитки', 4.2], ['Гидроизоляция пола', 4.2], ['Укладка плитки на пол', 4.2],
          ['Укладка плитки на стены', 17], ['Затирка швов', 21], ['Установка унитаза', 1],
          ['Установка раковины с тумбой', 1],
        ],
        materials: [
          ['Плиточный клей', { area: 21 }], ['Гидроизоляция обмазочная', { area: 4.2 }],
          ['Плитка керамическая', { area: 21 }], ['Унитаз с инсталляцией', { qty: 1 }],
          ['Раковина с тумбой', { qty: 1 }], ['Смеситель для раковины', { qty: 1 }],
        ],
      },
      {
        name: 'Прихожая', area: '1.8',
        works: [['Демонтаж плитки', 1.8], ['Укладка керамогранита', 1.8], ['Покраска стен', 6]],
        materials: [['Керамогранит', { area: 1.8 }], ['Краска для стен', { area: 6 }]],
      },
    ],
  },
  {
    name: 'Двухкомнатная в Одинцово',
    address: 'Одинцово, ул. Можайское шоссе, 8, кв. 105',
    area: '54',
    description: 'Новый объект. Смета в работе: согласовываем объёмы демонтажа и электрики.',
    public: false,
    rooms: [
      {
        name: 'Гостиная', area: '20',
        works: [['Демонтаж старых обоев', 20], ['Разводка электрики', 20], ['Шпаклёвка стен под покраску', 42]],
        materials: [['Грунтовка глубокого проникновения', { area: 42 }], ['Краска для стен', { area: 42 }]],
      },
      {
        name: 'Спальня', area: '14',
        works: [['Демонтаж старых обоев', 14], ['Шпаклёвка стен под покраску', 30]],
        materials: [['Грунтовка глубокого проникновения', { area: 30 }]],
      },
    ],
  },
];

function now() {
  return nowIso();
}

function insertWorkCatalog(db, [name, category, unit, price, description]) {
  const timestamp = now();
  const result = db
    .prepare(
      `INSERT INTO work_catalog (name, category, unit, price_kopecks, description, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(name, category, unit, price * 100, description || null, timestamp, timestamp);
  return { id: Number(result.lastInsertRowid), name, category, unit, priceKopecks: price * 100 };
}

function insertMaterialCatalog(db, item) {
  const timestamp = now();
  const result = db
    .prepare(
      `INSERT INTO material_catalog
         (name, category, purchase_unit, package_size, consumption_unit, consumption_rate, price_kopecks, description, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      item.name,
      item.category,
      item.purchaseUnit,
      item.packageSize,
      item.consumptionUnit,
      item.rate,
      item.price * 100,
      item.description || null,
      timestamp,
      timestamp,
    );
  return {
    id: Number(result.lastInsertRowid),
    name: item.name,
    category: item.category,
    purchaseUnit: item.purchaseUnit,
    packageSize: item.packageSize,
    consumptionUnit: item.consumptionUnit,
    rate: item.rate,
    priceKopecks: item.price * 100,
  };
}

function insertWorkLine(db, roomId, work, quantity, sortOrder) {
  const quantityMicro = parseDecimal(String(quantity)) ?? 0n;
  const amount = workAmountKopecks(work.priceKopecks, quantityMicro);
  const timestamp = now();
  db.prepare(
    `INSERT INTO estimate_lines
       (room_id, kind, source_item_id, name, category, unit, price_kopecks, quantity, amount_kopecks, sort_order, created_at, updated_at)
     VALUES (?, 'work', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    roomId,
    work.id,
    work.name,
    work.category,
    work.unit,
    work.priceKopecks,
    microToInput(quantityMicro, 6),
    amount,
    sortOrder,
    timestamp,
    timestamp,
  );
}

function insertMaterialLine(db, roomId, material, options, roomArea, sortOrder) {
  const calcArea = options.area !== undefined
    ? parseDecimal(String(options.area))
    : parseDecimal(String(roomArea ?? ''));
  const packageSize = material.packageSize === null || material.packageSize === undefined
    ? null
    : parseDecimal(String(material.packageSize));
  const consumptionRate = material.rate === null || material.rate === undefined
    ? null
    : parseDecimal(String(material.rate));
  const mode = options.qty !== undefined ? 'manual' : (consumptionRate !== null && calcArea !== null ? 'auto' : 'manual');
  const manualQty = options.qty !== undefined ? parseDecimal(String(options.qty)) : null;
  const computed = computeMaterialLine({
    mode,
    quantity: manualQty,
    priceKopecks: material.priceKopecks,
    calcArea,
    consumptionRate,
    packageSize,
  });
  const timestamp = now();
  db.prepare(
    `INSERT INTO estimate_lines
       (room_id, kind, source_item_id, name, category, unit, price_kopecks, quantity, amount_kopecks,
        sort_order, purchase_unit, package_size, consumption_unit, consumption_rate, calc_area, calc_mode,
        description, created_at, updated_at)
     VALUES (?, 'material', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    roomId,
    material.id,
    material.name,
    material.category,
    material.purchaseUnit,
    material.priceKopecks,
    microToInput(computed.quantityMicro, 6),
    computed.amountKopecks,
    sortOrder,
    material.purchaseUnit,
    material.packageSize,
    material.consumptionUnit,
    material.rate,
    calcArea === null ? null : microToInput(calcArea, 6),
    mode,
    material.description || null,
    timestamp,
    timestamp,
  );
}

function seedCatalogs(db) {
  const counts = db.prepare('SELECT (SELECT COUNT(*) FROM work_catalog) AS works, (SELECT COUNT(*) FROM material_catalog) AS materials').get();
  if (Number(counts.works) > 0 || Number(counts.materials) > 0) return null;
  const works = new Map();
  for (const item of WORKS) {
    const inserted = insertWorkCatalog(db, item);
    works.set(inserted.name, inserted);
  }
  const materials = new Map();
  for (const item of MATERIALS) {
    const inserted = insertMaterialCatalog(db, item);
    materials.set(inserted.name, inserted);
  }
  return { works, materials };
}

function seedProjects(db, catalogs) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM projects').get();
  if (Number(existing.count) > 0) return;

  for (const [projectIndex, project] of DEMO_PROJECTS.entries()) {
    const createdAt = new Date(Date.now() - (projectIndex + 1) * 86400000 * 3).toISOString();
    const updatedAt = new Date(Date.now() - projectIndex * 86400000).toISOString();
    const token = project.public ? randomToken(32) : null;
    const result = db
      .prepare(
        `INSERT INTO projects (name, address, total_area, description, public_token, public_enabled, public_created_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.name,
        project.address,
        project.area,
        project.description,
        token,
        project.public ? 1 : 0,
        project.public ? createdAt : null,
        createdAt,
        updatedAt,
      );
    const projectId = Number(result.lastInsertRowid);

    for (const [roomIndex, room] of project.rooms.entries()) {
      const roomTimestamp = new Date(Date.now() - (projectIndex * 10 + roomIndex + 1) * 3600000).toISOString();
      const roomResult = db
        .prepare(
          `INSERT INTO rooms (project_id, name, area, description, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(projectId, room.name, room.area, null, roomIndex + 1, roomTimestamp, roomTimestamp);
      const roomId = Number(roomResult.lastInsertRowid);

      let workOrder = 1;
      for (const [workName, quantity] of room.works) {
        const work = catalogs.works.get(workName);
        if (!work) continue;
        insertWorkLine(db, roomId, work, quantity, workOrder);
        workOrder += 1;
      }

      let materialOrder = 1;
      for (const [materialName, options] of room.materials) {
        const material = catalogs.materials.get(materialName);
        if (!material) continue;
        insertMaterialLine(db, roomId, material, options, room.area, materialOrder);
        materialOrder += 1;
      }
    }
  }
}

export async function seedDatabase(db) {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  let adminCreated = false;
  if (Number(userCount.count) === 0) {
    const timestamp = now();
    db.prepare(
      'INSERT INTO users (login, password_hash, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(config.adminLogin, await hashPassword(config.adminPassword), 'Администратор', timestamp, timestamp);
    adminCreated = true;
  }

  const settingsCount = db.prepare('SELECT COUNT(*) AS count FROM app_settings').get();
  if (Number(settingsCount.count) === 0) {
    setSettings(db, DEFAULT_SETTINGS);
  }

  const catalogs = config.seedDemo ? seedCatalogs(db) : null;
  if (config.seedDemo && catalogs) {
    seedProjects(db, catalogs);
  }

  return { adminCreated };
}
