SELECT id, phone_number, reply_text, conversation_history, created_at, cobroking_status 
FROM outreach 
WHERE phone_number = '6591051399' 
ORDER BY created_at DESC 
LIMIT 10;