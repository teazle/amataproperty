import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '../../../../../workers/supa';

/**
 * POST /api/admin/ai-prompts/activate
 * Activate a specific AI prompt (deactivates all others)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt_id } = body;

    if (!prompt_id) {
      return NextResponse.json(
        { error: 'Prompt ID is required' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // First, deactivate all prompts
    await supabase
      .from('ai_prompts')
      .update({ is_active: false });

    // Then activate the selected prompt
    const { data: activatedPrompt, error } = await supabase
      .from('ai_prompts')
      .update({ 
        is_active: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', prompt_id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ 
      success: true, 
      prompt: activatedPrompt,
      message: 'AI prompt activated successfully'
    });
  } catch (error: any) {
    console.error('Error activating prompt:', error);
    return NextResponse.json(
      { error: 'Failed to activate AI prompt' },
      { status: 500 }
    );
  }
}
