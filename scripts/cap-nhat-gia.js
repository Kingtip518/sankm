// SănKM – chương trình lấy giá vé máy bay (bản 2)
// Lấy từ Travelpayouts (dữ liệu Aviasales) rồi ghi ra tệp data.json cho trang web đọc.
// Mỗi chặng lấy 4 loại giá:
//   mot_chieu        : vé một chiều, hạng phổ thông, rẻ nhất mỗi ngày
//   khu_hoi          : vé khứ hồi, hạng phổ thông, rẻ nhất theo ngày đi
//   thuong_gia_mc    : vé một chiều, hạng thương gia
//   thuong_gia_kh    : vé khứ hồi, hạng thương gia
// Giá là giá cho 1 người lớn. Nguồn không có giá trẻ em.
// Chạy bằng Node 20 trở lên. Mã truy cập đọc từ biến môi trường TP_TOKEN.

const fs = require('fs');
const path = require('path');

const MA_TRUY_CAP = process.env.TP_TOKEN;
if (!MA_TRUY_CAP) {
  console.log('Chưa có mã truy cập TP_TOKEN: bỏ qua lấy giá, vẫn đăng trang.');
  process.exit(0);
}

// ===== DANH SÁCH CHẶNG BAY =====
// Mỗi dòng: [mã điểm đi, mã điểm đến]. Mã sân bay hoặc mã thành phố (SEL = Seoul, TYO = Tokyo...).
const CHANG_NOI_DIA = [
  ['HAN', 'SGN'], ['SGN', 'HAN'], ['HAN', 'DAD'], ['DAD', 'HAN'],
  ['SGN', 'DAD'], ['DAD', 'SGN'], ['HAN', 'PQC'], ['PQC', 'HAN'],
  ['SGN', 'PQC'], ['PQC', 'SGN'], ['HAN', 'CXR'], ['CXR', 'HAN'],
  ['SGN', 'CXR'], ['CXR', 'SGN'], ['HAN', 'DLI'], ['DLI', 'HAN'],
  ['VDO', 'SGN'], ['SGN', 'VDO'], ['HPH', 'SGN'], ['SGN', 'HPH'],
  ['HAN', 'VCA'], ['VCA', 'HAN'], ['SGN', 'HUI'], ['HUI', 'SGN']
];
// Từ Việt Nam đi nước ngoài
const CHANG_DI_QUOC_TE = [
  ['HAN', 'BKK'], ['HAN', 'SIN'], ['HAN', 'SEL'], ['HAN', 'TYO'], ['HAN', 'TPE'], ['HAN', 'KUL'], ['HAN', 'HKG'], ['HAN', 'SHA'],
  ['SGN', 'BKK'], ['SGN', 'SIN'], ['SGN', 'SEL'], ['SGN', 'TYO'], ['SGN', 'TPE'], ['SGN', 'KUL'], ['SGN', 'HKG'], ['SGN', 'SHA'],
  ['DAD', 'SEL']
];
// Từ nước ngoài đến Việt Nam (khách Hàn, Nhật, Trung, Thái...)
const CHANG_DEN_VIET_NAM = [
  ['SEL', 'DAD'], ['SEL', 'HAN'], ['SEL', 'SGN'], ['SEL', 'CXR'], ['SEL', 'PQC'],
  ['TYO', 'HAN'], ['TYO', 'SGN'], ['TYO', 'DAD'],
  ['TPE', 'SGN'], ['TPE', 'HAN'],
  ['BKK', 'HAN'], ['BKK', 'SGN'], ['SIN', 'SGN'],
  ['CAN', 'HAN'], ['CAN', 'SGN'], ['SHA', 'SGN'],
  ['HKG', 'HAN'], ['HKG', 'SGN']
];
const CHANG_BAY = CHANG_NOI_DIA.concat(CHANG_DI_QUOC_TE, CHANG_DEN_VIET_NAM);

// Lấy giá cho bao nhiêu tháng, tính từ tháng hiện tại
const SO_THANG = 2;
// Có lấy giá hạng thương gia hay không
const LAY_THUONG_GIA = true;
// Nghỉ giữa hai lần hỏi (mili giây) để không hỏi dồn dập
const NGHI_GIUA_LAN_HOI = 300;

const DIA_CHI_GOC = 'https://api.travelpayouts.com';

function thangThu(n) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7); // dạng 2026-11
}
function nghi(ms) { return new Promise(function (xong) { setTimeout(xong, ms); }); }

// Hỏi máy chủ, tự thử lại khi bị báo hỏi quá nhanh (mã 429) hoặc lỗi tạm thời
async function hoi(duongDan, thamSo) {
  const dc = new URL(DIA_CHI_GOC + duongDan);
  Object.keys(thamSo).forEach(function (k) {
    if (thamSo[k] !== '' && thamSo[k] !== undefined) dc.searchParams.set(k, thamSo[k]);
  });
  for (let lan = 1; lan <= 3; lan++) {
    const tl = await fetch(dc, { headers: { 'X-Access-Token': MA_TRUY_CAP } });
    if (tl.status === 429 || tl.status >= 500) { await nghi(5000 * lan); continue; }
    if (!tl.ok) throw new Error('Máy chủ trả lỗi ' + tl.status);
    const kq = await tl.json();
    if (kq.success === false) throw new Error(kq.error || 'Máy chủ báo không thành công');
    return Array.isArray(kq.data) ? kq.data : [];
  }
  throw new Error('Thử 3 lần vẫn lỗi');
}

// Hỏi theo thị trường Việt Nam trước, không có thì hỏi lại theo thị trường mặc định
async function hoiHaiThiTruong(duongDan, thamSo) {
  let ds = await hoi(duongDan, Object.assign({}, thamSo, { market: 'vn' }));
  if (ds.length === 0) {
    await nghi(NGHI_GIUA_LAN_HOI);
    ds = await hoi(duongDan, thamSo);
  }
  return ds;
}

const homNay = new Date().toISOString().slice(0, 10);

// Giữ 1 vé rẻ nhất cho mỗi ngày đi
function giuReNhat(bang, ve) {
  if (!ve.ngay || !ve.gia || ve.ngay < homNay) return;
  if (bang[ve.ngay] && bang[ve.ngay].gia <= ve.gia) return;
  bang[ve.ngay] = ve;
}
function sapXep(bang) {
  return Object.values(bang).sort(function (a, b) { return a.ngay < b.ngay ? -1 : 1; });
}

// Vé hạng phổ thông (một chiều hoặc khứ hồi) theo từng tháng
async function layPhoThong(diemDi, diemDen, khuHoi) {
  const bang = {};
  for (let i = 0; i < SO_THANG; i++) {
    const thang = thangThu(i);
    const thamSo = {
      origin: diemDi, destination: diemDen, departure_at: thang,
      currency: 'vnd', sorting: 'price', direct: 'false', limit: '1000',
      one_way: khuHoi ? 'false' : 'true'
    };
    if (khuHoi) thamSo.return_at = thang;
    try {
      const ds = await hoiHaiThiTruong('/aviasales/v3/prices_for_dates', thamSo);
      for (const v of ds) {
        if (!v.departure_at || !v.price) continue;
        if (khuHoi && !v.return_at) continue;   // khứ hồi thì phải có ngày về
        if (!khuHoi && v.return_at) continue;   // một chiều thì không có ngày về
        giuReNhat(bang, {
          ngay: v.departure_at.slice(0, 10),
          gio: v.departure_at.slice(11, 16),
          gia: Math.round(v.price),
          hang: v.airline || '',
          so_hieu: v.flight_number ? (v.airline || '') + v.flight_number : '',
          phut: v.duration_to || v.duration || 0,
          dung: v.transfers || 0,
          ngay_ve: khuHoi ? v.return_at.slice(0, 10) : '',
          gio_ve: khuHoi ? v.return_at.slice(11, 16) : '',
          dung_ve: khuHoi ? (v.return_transfers || 0) : 0,
          duong_dan: v.link ? 'https://www.aviasales.com' + v.link : ''
        });
      }
    } catch (loi) {
      demLoi++;
      console.error('Lỗi ' + diemDi + '-' + diemDen + (khuHoi ? ' khứ hồi' : ' một chiều') + ' tháng ' + thang + ': ' + loi.message);
    }
    await nghi(NGHI_GIUA_LAN_HOI);
  }
  return sapXep(bang);
}

// Vé hạng thương gia: nguồn chỉ có giá theo năm, không có hãng và số hiệu chuyến
async function layThuongGia(diemDi, diemDen, khuHoi) {
  const bang = {};
  const namNay = new Date().getUTCFullYear();
  const cacNam = [String(namNay)];
  if (thangThu(SO_THANG - 1).slice(0, 4) !== String(namNay)) cacNam.push(String(namNay + 1));
  const ngayCuoi = thangThu(SO_THANG) + '-01';
  for (const nam of cacNam) {
    try {
      const ds = await hoiHaiThiTruong('/aviasales/v3/get_latest_prices', {
        origin: diemDi, destination: diemDen, currency: 'vnd',
        period_type: 'year', beginning_of_period: nam,
        one_way: khuHoi ? 'false' : 'true', trip_class: '1',
        sorting: 'price', show_to_affiliates: 'false', limit: '1000'
      });
      for (const v of ds) {
        if (!v.depart_date || !v.value) continue;
        if (v.trip_class !== undefined && Number(v.trip_class) !== 1) continue;
        if (khuHoi && !v.return_date) continue;
        if (!khuHoi && v.return_date) continue;
        if (v.depart_date >= ngayCuoi) continue;
        giuReNhat(bang, {
          ngay: v.depart_date.slice(0, 10), gio: '',
          gia: Math.round(v.value), hang: '', so_hieu: '',
          phut: v.duration || 0, dung: v.number_of_changes || 0,
          ngay_ve: khuHoi ? v.return_date.slice(0, 10) : '', gio_ve: '', dung_ve: 0,
          duong_dan: ''
        });
      }
    } catch (loi) {
      demLoi++;
      console.error('Lỗi ' + diemDi + '-' + diemDen + ' thương gia năm ' + nam + ': ' + loi.message);
    }
    await nghi(NGHI_GIUA_LAN_HOI);
  }
  return sapXep(bang);
}

// Tỷ giá để trang đổi tiền đồng sang đô la Mỹ, won, yên, nhân dân tệ.
// Nguồn trả về: mỗi đơn vị tiền đổi được bao nhiêu rúp.
async function layTyGia() {
  try {
    const tl = await fetch('https://yasen.aviasales.com/adaptors/currency.json');
    if (!tl.ok) throw new Error('mã ' + tl.status);
    const r = await tl.json();
    const vnd = Number(r.vnd);
    const kq = {};
    ['usd', 'krw', 'jpy', 'cny', 'eur'].forEach(function (m) {
      const x = Number(r[m]);
      if (vnd > 0 && x > 0) kq[m.toUpperCase()] = vnd / x; // 1 đồng = bao nhiêu đơn vị tiền kia
    });
    // Kiểm tra cho chắc: 1 đô la phải trong khoảng 15.000 – 40.000 đồng
    if (!kq.USD || 1 / kq.USD < 15000 || 1 / kq.USD > 40000) throw new Error('tỷ giá bất thường');
    return kq;
  } catch (loi) {
    console.error('Không lấy được tỷ giá: ' + loi.message + ' (trang chỉ hiện tiền đồng)');
    return null;
  }
}

let demLoi = 0;

async function chay() {
  const ketQua = {};
  const dem = { mot_chieu: 0, khu_hoi: 0, thuong_gia_mc: 0, thuong_gia_kh: 0 };

  for (const [diemDi, diemDen] of CHANG_BAY) {
    const muc = {};
    muc.mot_chieu = await layPhoThong(diemDi, diemDen, false);
    muc.khu_hoi = await layPhoThong(diemDi, diemDen, true);
    if (LAY_THUONG_GIA) {
      muc.thuong_gia_mc = await layThuongGia(diemDi, diemDen, false);
      muc.thuong_gia_kh = await layThuongGia(diemDi, diemDen, true);
    }
    Object.keys(dem).forEach(function (k) { dem[k] += (muc[k] || []).length; });
    ketQua[diemDi + '-' + diemDen] = muc;
    console.log(diemDi + ' -> ' + diemDen + ': một chiều ' + muc.mot_chieu.length +
      ', khứ hồi ' + muc.khu_hoi.length +
      ', thương gia ' + ((muc.thuong_gia_mc || []).length + (muc.thuong_gia_kh || []).length) + ' ngày có giá');
  }

  const tong = dem.mot_chieu + dem.khu_hoi + dem.thuong_gia_mc + dem.thuong_gia_kh;
  if (tong === 0) {
    console.error('Không lấy được vé nào (số lần lỗi: ' + demLoi + '). Giữ nguyên dữ liệu cũ.');
    process.exit(1);
  }

  const duLieu = {
    phien_ban: 2,
    cap_nhat_luc: new Date().toISOString(),
    tien_te: 'VND',
    ty_gia: await layTyGia(),
    nguon: 'Travelpayouts / Aviasales',
    chang: ketQua
  };
  // Bỏ các ô trống hoặc bằng 0 cho tệp nhẹ hơn (trang tự hiểu là trống / 0)
  const boTrong = function (k, v) { return (v === '' || v === 0) ? undefined : v; };
  fs.writeFileSync(path.join(__dirname, '..', 'data.json'), JSON.stringify(duLieu, boTrong));
  console.log('TỔNG KẾT: một chiều ' + dem.mot_chieu + ', khứ hồi ' + dem.khu_hoi +
    ', thương gia một chiều ' + dem.thuong_gia_mc + ', thương gia khứ hồi ' + dem.thuong_gia_kh +
    ' ngày có giá; ' + demLoi + ' lần lỗi.');
}

chay().catch(function (loi) {
  console.error('Lỗi không mong muốn: ' + loi.message);
  process.exit(1);
});
