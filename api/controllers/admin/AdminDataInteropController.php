<?php
declare(strict_types=1);

/**
 * Import-mapping support for the HR Import Wizard.
 *
 * The standalone "Data Interop" module (guided imports/exports/backups) was
 * removed. Only the two endpoints the Employees/Attendance import wizard still
 * calls remain here: a CSV template download and AI-assisted column mapping.
 */
class AdminDataInteropController
{
    public function template(Request $request): void
    {
        $template = DataImportMapper::template((string)$request->param('module'));
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        header_remove('Content-Type');
        header('Content-Type: text/csv; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . addcslashes($template['filename'], '"\\') . '"');
        echo $template['content'];
        exit;
    }

    public function aiMap(Request $request): void
    {
        $jobId = (int)$request->param('job');
        if ($jobId <= 0) {
            Response::error('Invalid import job ID', 400);
        }
        Response::success(
            DataImportMapper::aiSuggestMapping((string)$request->param('module'), $jobId),
            'AI suggested a column mapping from the file headers'
        );
    }
}
