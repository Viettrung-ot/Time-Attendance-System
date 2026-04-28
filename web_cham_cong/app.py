import streamlit as st
import pandas as pd
import random
from datetime import datetime
import os

# Cấu hình trang
st.set_page_config(
    page_title="Hệ thống chấm công IoT",
    page_icon="📅",
    layout="wide"
)

# Đường dẫn file dữ liệu
DATA_FILE = 'data.csv'

# Hàm load dữ liệu
def load_data():
    if not os.path.exists(DATA_FILE):
        return pd.DataFrame(columns=["ID", "Ho_Ten", "Thoi_Gian", "Ngay", "Trang_Thai"])
    try:
        df = pd.read_csv(DATA_FILE)
        return df
    except Exception as e:
        st.error(f"Lỗi khi đọc file dữ liệu: {e}")
        return pd.DataFrame()

# Hàm tô màu cho bảng
def highlight_rows(row):
    color = ''
    if row['Trang_Thai'] == 'Đi muộn':
        color = 'background-color: #ffcccc; color: #990000' # Màu đỏ nhạt
    elif row['Trang_Thai'] == 'Đúng giờ':
        color = 'background-color: #ccffcc; color: #006600' # Màu xanh nhạt
    return [color] * len(row)

# === SIDEBAR ===
st.sidebar.title("🔧 Bảng điều khiển")
st.sidebar.markdown("---")

if st.sidebar.button("📡 Giả lập ESP32 gửi dữ liệu"):
    # Danh sách tên mẫu
    names = ["Nguyễn Văn A", "Trần Thị B", "Lê Văn C", "Phạm Văn D", "Hoàng Thị E", "Vũ Văn F"]
    
    # Tạo dữ liệu ngẫu nhiên
    new_id = random.randint(1000, 9999)
    new_name = random.choice(names)
    now = datetime.now()
    new_date = now.strftime("%Y-%m-%d")
    
    # Random thời gian điểm danh quanh mốc 8:00
    hour = 7 if random.random() > 0.5 else 8
    minute = random.randint(0, 59)
    second = random.randint(0, 59)
    check_in_time = f"{hour:02}:{minute:02}:{second:02}"
    
    # Logic xác định trạng thái (Ví dụ: sau 08:00:00 là muộn)
    is_late = (hour > 8) or (hour == 8 and minute > 0)
    # Tuy nhiên để đảm bảo tính ngẫu nhiên như yêu cầu đề bài (có cả muộn cả đúng giờ rải rác)
    # Ta có thể dùng logic đơn giản hơn hoặc theo time thực tế
    if is_late:
        status = "Đi muộn"
    else:
        status = "Đúng giờ"

    # Tạo DataFrame dòng mới
    new_data = pd.DataFrame([{
        "ID": new_id,
        "Ho_Ten": new_name,
        "Thoi_Gian": check_in_time,
        "Ngay": new_date,
        "Trang_Thai": status
    }])

    # Lưu vào file CSV (mode 'a' - append)
    # Kiểm tra header
    header = not os.path.exists(DATA_FILE)
    new_data.to_csv(DATA_FILE, mode='a', header=header, index=False)
    
    st.sidebar.success(f"Đã thêm: {new_name} - {status}")

st.sidebar.markdown("---")
st.sidebar.info("Nhấn nút trên để thêm dữ liệu mẫu vào file CSV.")

# === MAIN BOARD ===
st.title("📊 Hệ thống Quản lý Chấm công IoT")
st.markdown("Dữ liệu được cập nhật từ thiết bị cảm biến vân tay/thẻ từ.")

# Nút làm mới (thực ra Streamlit tự reload khi có tương tác, nhưng nút này giúp reload chủ động)
if st.button("🔄 Làm mới dữ liệu"):
    st.rerun()

# Đọc dữ liệu
df = load_data()

if not df.empty:
    # --- THỐNG KÊ (METRICS) ---
    col1, col2, col3 = st.columns(3)
    
    total_staff = len(df)
    late_count = len(df[df['Trang_Thai'] == 'Đi muộn'])
    ontime_count = len(df[df['Trang_Thai'] == 'Đúng giờ'])
    
    col1.metric("Tổng nhân viên đã đến", f"{total_staff} người")
    col2.metric("Số người đi muộn", f"{late_count} người", delta="-Bad", delta_color="inverse")
    col3.metric("Số người đúng giờ", f"{ontime_count} người", delta="Good")

    st.markdown("### 📋 Lịch sử chấm công chi tiết")
    
    # Hiển thị bảng với styling
    # Sắp xếp theo mới nhất lên đầu (nếu muốn)
    # df = df.sort_index(ascending=False) 
    
    st.dataframe(
        df.style.apply(highlight_rows, axis=1),
        use_container_width=True,
        height=400
    )
else:
    st.warning("Chưa có dữ liệu nào trong hệ thống.")

st.markdown("---")
st.caption("Developed for IoT Project - Python Streamlit")
