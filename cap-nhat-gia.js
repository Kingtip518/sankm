// Lấy giá vé máy bay rẻ nhất theo từng ngày từ Travelpayouts (dữ liệu Aviasales)
// rồi ghi ra tệp data.json để trang web đọc.
// Chạy bằng Node 20 trở lên. Mã truy cập đọc từ biến môi trường TP_TOKEN
// (trên GitHub đặt trong mục bí mật, không ghi thẳng vào tệp này).

const fs = require('fs');
const path = require('path');

const MA_TRUY_CAP = process.env.TP_TOKEN;
// Chưa có mã thì bỏ qua bước lấy giá, trang vẫn được đăng (hiện "Chưa có dữ liệu giá")
if (!MA_TRUY_CAP) {
  console.log('Chưa có mã truy cập TP_TOKEN: bỏ qua lấy giá, vẫn đăng trang.');
  process.exit(0);
}

// Danh sách chặng bay cần lấy giá (mã sân bay đi, mã sân bay đến).
// Muốn thêm chặng thì thêm một dòng theo đúng mẫu.
const CHANG_BAY = [
  ['HAN', 'SGN'], ['SGN', 'HAN'],
  ['HAN', 'DAD'], ['DAD', 'HAN'],
  ['SGN', 'DAD'], ['DAD', 'SGN'],
  ['HAN', 'PQC'], ['PQC', 'HAN'],
  ['SGN', 'PQC'], ['PQC', 'SGN'],
  ['HAN', 'CXR'], ['CXR', 'HAN'],
  ['SGN', 'CXR'], ['CXR', 'SGN'],
  ['HAN', 'DLI'], ['DLI', 'HAN'],
  ['VDO', 'SGN'], ['SGN', 'VDO'],
  ['HPH', 'SGN'], ['SGN', 'HPH'],
  ['HAN', 'VCA'], ['VCA', 'HAN'],
  ['SGN', 'HUI'], ['HUI', 'SGN']
];

// Lấy giá cho bao nhiêu tháng, tính từ tháng hiện tại
const SO_THANG = 2;

// Nghỉ giữa hai lần hỏi giá (mili giây) để không hỏi dồn dập
const NGHI_GIUA_LAN_HOI = 400;

function thangThu(n) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7); // dạng 2026-11
}

function nghi(ms) {
  return new Promise(function (xong) { setTimeout(xong, ms); });
}

async function hoiGia(diemDi, diemDen, thang, thiTruong) {
  const dc = new URL('https://api.travelpayouts.com/aviasales/v3/prices_for_dates');
  dc.searchParams.set('origin', diemDi);
  dc.searchParams.set('destination', diemDen);
  dc.searchParams.set('departure_at', thang);
  dc.searchParams.set('currency', 'vnd');
  dc.searchParams.set('sorting', 'price');
  dc.searchParams.set('direct', 'false');
  dc.searchParams.set('one_way', 'true');
  dc.searchParams.set('limit', '100');
  if (thiTruong) dc.searchParams.set('market', thiTruong);

  const tl = await fetch(dc, { headers: { 'X-Access-Token': MA_TRUY_CAP } });
  if (!tl.ok) throw new Error('Máy chủ trả lỗi ' + tl.status);
  const kq = await tl.json();
  if (kq.success === false) throw new Error(kq.error || 'Máy chủ báo không thành công');
  return Array.isArray(kq.data) ? kq.data : [];
}

// Hỏi theo thị trường Việt Nam trước; nếu không có vé nào thì hỏi lại theo thị trường mặc định
async function layGiaMotThang(diemDi, diemDen, thang) {
  let ve = await hoiGia(diemDi, diemDen, thang, 'vn');
  if (ve.length === 0) {
    await nghi(NGHI_GIUA_LAN_HOI);
    ve = await hoiGia(diemDi, diemDen, thang, '');
  }
  return ve;
}

async function chay() {
  const homNay = new Date().toISOString().slice(0, 10);
  const ketQua = {};
  let soLanLoi = 0;
  let soVe = 0;

  for (const [diemDi, diemDen] of CHANG_BAY) {
    const theoNgay = {}; // mỗi ngày giữ một vé rẻ nhất
    for (let i = 0; i < SO_THANG; i++) {
      const thang = thangThu(i);
      try {
        const ve = await layGiaMotThang(diemDi, diemDen, thang);
        for (const v of ve) {
          if (!v.departure_at || !v.price) continue;
          const ngay = v.departure_at.slice(0, 10);
          if (ngay < homNay) continue;
          if (theoNgay[ngay] && theoNgay[ngay].gia <= v.price) continue;
          theoNgay[ngay] = {
            ngay: ngay,
            gio: v.departure_at.slice(11, 16),
            gia: Math.round(v.price),
            hang: v.airline || '',
            so_hieu: (v.airline || '') + (v.flight_number || ''),
            thoi_gian_phut: v.duration_to || v.duration || 0,
            so_diem_dung: v.transfers || 0,
            duong_dan: v.link ? 'https://www.aviasales.com' + v.link : ''
          };
        }
      } catch (loi) {
        soLanLoi++;
        console.error('Lỗi chặng ' + diemDi + '-' + diemDen + ' tháng ' + thang + ': ' + loi.message);
      }
      await nghi(NGHI_GIUA_LAN_HOI);
    }
    const danhSach = Object.values(theoNgay).sort(function (a, b) { return a.ngay < b.ngay ? -1 : 1; });
    ketQua[diemDi + '-' + diemDen] = danhSach;
    soVe += danhSach.length;
    console.log(diemDi + ' -> ' + diemDen + ': ' + danhSach.length + ' ngày có giá');
  }

  // Không lấy được vé nào thì dừng, giữ nguyên dữ liệu cũ trên trang
  if (soVe === 0) {
    console.error('Không lấy được vé nào (số lần lỗi: ' + soLanLoi + '). Giữ nguyên dữ liệu cũ.');
    process.exit(1);
  }

  const duLieu = {
    cap_nhat_luc: new Date().toISOString(),
    tien_te: 'VND',
    nguon: 'Travelpayouts / Aviasales',
    chang: ketQua
  };
  fs.writeFileSync(path.join(__dirname, '..', 'data.json'), JSON.stringify(duLieu));
  console.log('Đã ghi data.json: ' + soVe + ' ngày có giá, ' + soLanLoi + ' lần lỗi.');
}

chay().catch(function (loi) {
  console.error('Lỗi không mong muốn: ' + loi.message);
  process.exit(1);
});
