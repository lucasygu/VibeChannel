//
//  DateSeparator.swift
//  VibeChannel
//
//  Date separator between message groups.
//

import SwiftUI

struct DateSeparator: View {
    let date: String

    var body: some View {
        HStack {
            VStack { Divider() }
            Text(formatDateDisplay(date))
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
            VStack { Divider() }
        }
    }

    private func formatDateDisplay(_ dateStr: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"

        guard let date = formatter.date(from: dateStr) else {
            return dateStr
        }

        let calendar = Calendar.current

        if calendar.isDateInToday(date) {
            return "Today"
        }
        if calendar.isDateInYesterday(date) {
            return "Yesterday"
        }

        let displayFormatter = DateFormatter()

        // Check if same year
        if calendar.component(.year, from: date) == calendar.component(.year, from: Date()) {
            displayFormatter.dateFormat = "EEEE, MMMM d"
        } else {
            displayFormatter.dateFormat = "EEEE, MMMM d, yyyy"
        }

        return displayFormatter.string(from: date)
    }
}

#Preview {
    VStack(spacing: 20) {
        DateSeparator(date: {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            return formatter.string(from: Date())
        }())

        DateSeparator(date: {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy-MM-dd"
            return formatter.string(from: Date().addingTimeInterval(-86400))
        }())

        DateSeparator(date: "2025-01-15")
        DateSeparator(date: "2024-12-25")
    }
    .padding()
}
